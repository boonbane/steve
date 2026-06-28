import Contacts
import CoreGraphics
import Foundation
import ImageIO

private enum IMsgAuth: s32 {
  case notDetermined = 0
  case denied = 1
  case authorized = 2
}

private struct IMsgMatch: Encodable {
  let input: String
  let name: String
  let contactId: String
}

private final class IMsgBox: @unchecked Sendable {
  var value: s32 = IMsgAuth.denied.rawValue
}

private func imsgAuthStatus() -> IMsgAuth {
  let status = CNContactStore.authorizationStatus(for: .contacts)

  if status == .authorized {
    return .authorized
  }

  if status == .notDetermined {
    return .notDetermined
  }

  return .denied
}

private func imsgPhoneDigits(_ raw: String) -> String {
  var out = ""
  out.reserveCapacity(raw.count)

  for ch in raw {
    if ch >= "0" && ch <= "9" {
      out.append(ch)
    }
  }

  return out
}

// Compare phone numbers on their last 10 digits (the US national significant
// number). This collapses country-code and formatting differences between a
// chat handle and the stored contact, and is only consulted after an exact
// full-digit match misses.
private let imsgPhoneTailLength = 10

private func imsgPhoneTail(_ digits: String) -> String {
  if digits.count <= imsgPhoneTailLength {
    return digits
  }

  return String(digits.suffix(imsgPhoneTailLength))
}

private func imsgContactName(_ contact: CNContact) -> String {
  if let full = CNContactFormatter.string(from: contact, style: .fullName),
    !full.isEmpty
  {
    return full
  }

  if !contact.organizationName.isEmpty {
    return contact.organizationName
  }

  if !contact.nickname.isEmpty {
    return contact.nickname
  }

  return contact.identifier
}

@_cdecl("imsg_contacts_auth_status")
public func imsg_contacts_auth_status() -> s32 {
  return imsgAuthStatus().rawValue
}

@_cdecl("imsg_contacts_request_access")
public func imsg_contacts_request_access() -> s32 {
  let status = imsgAuthStatus()

  if status == .authorized {
    return status.rawValue
  }

  if status == .denied {
    return status.rawValue
  }

  let sem = DispatchSemaphore(value: 0)
  let out = IMsgBox()
  let store = CNContactStore()

  store.requestAccess(for: .contacts) { granted, _ in
    out.value = granted ? IMsgAuth.authorized.rawValue : IMsgAuth.denied.rawValue
    sem.signal()
  }

  sem.wait()
  return out.value
}

@_cdecl("imsg_contacts_resolve")
public func imsg_contacts_resolve(
  _ handlesRaw: UnsafePointer<UnsafePointer<CChar>?>?,
  _ count: u32,
  _ outLen: UnsafeMutablePointer<u32>?
) -> UnsafeMutableRawPointer? {
  outLen?.pointee = 0

  if imsgAuthStatus() != .authorized {
    return nil
  }

  if count > 0 && handlesRaw == nil {
    return nil
  }

  let descriptor = CNContactFormatter.descriptorForRequiredKeys(for: .fullName)
  let keys: [CNKeyDescriptor] = [
    descriptor,
    CNContactIdentifierKey as CNKeyDescriptor,
    CNContactOrganizationNameKey as CNKeyDescriptor,
    CNContactNicknameKey as CNKeyDescriptor,
    CNContactPhoneNumbersKey as CNKeyDescriptor,
    CNContactEmailAddressesKey as CNKeyDescriptor,
  ]
  let store = CNContactStore()

  // Enumerate every contact exactly once and index it by email and by phone
  // (full digits, and the last-10-digit tail). Resolving each handle is then an
  // in-memory dictionary lookup. The previous implementation ran one Contacts
  // query per handle plus a full-store enumeration for every miss — O(handles ×
  // contacts), tens of seconds on a large account; this is one enumeration plus
  // O(handles) lookups.
  var byEmail: [String: [CNContact]] = [:]
  var byPhoneFull: [String: [CNContact]] = [:]
  var byPhoneTail: [String: [CNContact]] = [:]

  func index(
    _ table: inout [String: [CNContact]],
    _ key: String,
    _ contact: CNContact
  ) {
    if key.isEmpty {
      return
    }

    if var list = table[key] {
      if !list.contains(where: { $0.identifier == contact.identifier }) {
        list.append(contact)
        table[key] = list
      }
    } else {
      table[key] = [contact]
    }
  }

  let request = CNContactFetchRequest(keysToFetch: keys)
  try? store.enumerateContacts(with: request) { contact, _ in
    for email in contact.emailAddresses {
      let value = String(email.value)
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
      index(&byEmail, value, contact)
    }

    for phone in contact.phoneNumbers {
      let digits = imsgPhoneDigits(phone.value.stringValue)
      index(&byPhoneFull, digits, contact)
      index(&byPhoneTail, imsgPhoneTail(digits), contact)
    }
  }

  var matches: [IMsgMatch] = []
  matches.reserveCapacity(Int(count))

  for idx in 0..<Int(count) {
    guard let item = handlesRaw!.advanced(by: idx).pointee else {
      return nil
    }

    let input = String(cString: item)

    var contacts: [CNContact] = []
    if input.contains("@") {
      contacts = byEmail[input.lowercased()] ?? []
    } else {
      let digits = imsgPhoneDigits(input)
      if !digits.isEmpty {
        contacts = byPhoneFull[digits] ?? byPhoneTail[imsgPhoneTail(digits)] ?? []
      }
    }

    guard let first = contacts.first else {
      continue
    }

    matches.append(
      IMsgMatch(
        input: input,
        name: imsgContactName(first),
        contactId: first.identifier
      )
    )
  }

  guard let data = try? JSONEncoder().encode(matches), !data.isEmpty else {
    return nil
  }

  let length = data.count
  guard let buffer = malloc(length) else {
    return nil
  }

  data.copyBytes(to: buffer.assumingMemoryBound(to: UInt8.self), count: length)
  outLen?.pointee = u32(length)
  return buffer
}

@_cdecl("imsg_contacts_resolve_free")
public func imsg_contacts_resolve_free(_ ptr: UnsafeMutableRawPointer?) {
  free(ptr)
}

private func imsgEncodeThumbnail(_ data: Data, _ maxPixel: Int) -> Data? {
  guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
    return nil
  }

  let thumbOptions: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: maxPixel,
  ]
  guard
    let thumbnail = CGImageSourceCreateThumbnailAtIndex(
      source, 0, thumbOptions as CFDictionary)
  else {
    return nil
  }

  let output = NSMutableData()
  // The stable system UTI for JPEG (what kUTTypeJPEG resolves to); used as a
  // literal so this doesn't require the macOS 11+ UniformTypeIdentifiers API.
  guard
    let destination = CGImageDestinationCreateWithData(
      output as CFMutableData, "public.jpeg" as CFString, 1, nil)
  else {
    return nil
  }

  let destOptions: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: 0.8]
  CGImageDestinationAddImage(destination, thumbnail, destOptions as CFDictionary)
  guard CGImageDestinationFinalize(destination) else {
    return nil
  }

  return output as Data
}

@_cdecl("imsg_contact_image")
public func imsg_contact_image(
  _ identifierRaw: UnsafePointer<CChar>?,
  _ maxPixel: u32,
  _ outLen: UnsafeMutablePointer<u32>?
) -> UnsafeMutableRawPointer? {
  outLen?.pointee = 0

  guard let identifierRaw else {
    return nil
  }

  if imsgAuthStatus() != .authorized {
    return nil
  }

  let identifier = String(cString: identifierRaw)
  let store = CNContactStore()
  let keys = [CNContactThumbnailImageDataKey as CNKeyDescriptor]

  guard
    let contact = try? store.unifiedContact(withIdentifier: identifier, keysToFetch: keys),
    let data = contact.thumbnailImageData,
    let encoded = imsgEncodeThumbnail(data, maxPixel == 0 ? 128 : Int(maxPixel)),
    !encoded.isEmpty
  else {
    return nil
  }

  let count = encoded.count
  guard let buffer = malloc(count) else {
    return nil
  }

  encoded.copyBytes(to: buffer.assumingMemoryBound(to: UInt8.self), count: count)
  outLen?.pointee = u32(count)
  return buffer
}

@_cdecl("imsg_contact_image_free")
public func imsg_contact_image_free(_ ptr: UnsafeMutableRawPointer?) {
  free(ptr)
}
