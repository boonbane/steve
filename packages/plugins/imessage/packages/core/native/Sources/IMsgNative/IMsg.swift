import Contacts
import Foundation

private enum IMsgAuth: s32 {
  case notDetermined = 0
  case denied = 1
  case authorized = 2
}

private enum IMsgKind: u8 {
  case none = 0
  case phone = 1
  case email = 2
  case im = 3
}

private final class IMsgRow {
  let found: u8
  let ambiguous: u8
  let kind: u8
  let input: UnsafeMutablePointer<CChar>?
  let name: UnsafeMutablePointer<CChar>?
  let contactID: UnsafeMutablePointer<CChar>?
  let canonical: UnsafeMutablePointer<CChar>?

  init(
    found: Bool,
    ambiguous: Bool,
    kind: IMsgKind,
    input: String,
    name: String?,
    contactID: String?,
    canonical: String?
  ) {
    self.found = found ? 1 : 0
    self.ambiguous = ambiguous ? 1 : 0
    self.kind = kind.rawValue
    self.input = strdup(input)
    self.name = name == nil ? nil : strdup(name!)
    self.contactID = contactID == nil ? nil : strdup(contactID!)
    self.canonical = canonical == nil ? nil : strdup(canonical!)
  }

  deinit {
    free(input)
    free(name)
    free(contactID)
    free(canonical)
  }
}

private final class IMsgResult {
  let rows: [IMsgRow]

  init(rows: [IMsgRow]) {
    self.rows = rows
  }
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

private func imsgResolveKind(_ value: String) -> IMsgKind {
  let lower = value.lowercased()

  if lower.hasPrefix("mailto:") {
    return .email
  }

  if lower.contains("@") {
    return .email
  }

  if lower.hasPrefix("tel:") || lower.hasPrefix("sms:") || lower.hasPrefix("imessage:") {
    return .phone
  }

  let set = CharacterSet(charactersIn: "+0123456789 ()-.")
  let stripped = value.trimmingCharacters(in: .whitespacesAndNewlines)

  if stripped.isEmpty {
    return .none
  }

  if stripped.rangeOfCharacter(from: set.inverted) == nil {
    return .phone
  }

  return .im
}

private func imsgNormalize(_ raw: String, _ kind: IMsgKind) -> String {
  let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)

  if kind == .email {
    if trimmed.lowercased().hasPrefix("mailto:") {
      return String(trimmed.dropFirst(7)).lowercased()
    }

    return trimmed.lowercased()
  }

  if kind == .phone {
    var value = trimmed
    let lower = trimmed.lowercased()

    if lower.hasPrefix("tel:") {
      value = String(trimmed.dropFirst(4))
    }

    if lower.hasPrefix("sms:") {
      value = String(trimmed.dropFirst(4))
    }

    if lower.hasPrefix("imessage:") {
      value = String(trimmed.dropFirst(9))
    }

    var out = ""
    out.reserveCapacity(value.count)

    for ch in value {
      if ch >= "0" && ch <= "9" {
        out.append(ch)
        continue
      }

      if ch == "+" && out.isEmpty {
        out.append(ch)
      }
    }

    return out
  }

  return trimmed
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
  let full = CNContactFormatter.string(from: contact, style: .fullName)
  if full != nil {
    if !full!.isEmpty {
      return full!
    }
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
  _ flags: u32,
  _ outRaw: UnsafeMutablePointer<UnsafeMutableRawPointer?>?
) -> s32 {
  _ = flags

  guard let outRaw else {
    return -1
  }

  outRaw.pointee = nil

  if imsgAuthStatus() != .authorized {
    return -2
  }

  if count > 0 {
    guard handlesRaw != nil else {
      return -1
    }
  }

  let descriptor = CNContactFormatter.descriptorForRequiredKeys(for: .fullName)
  let keys: [CNKeyDescriptor] = [
    descriptor,
    CNContactIdentifierKey as CNKeyDescriptor,
    CNContactGivenNameKey as CNKeyDescriptor,
    CNContactFamilyNameKey as CNKeyDescriptor,
    CNContactMiddleNameKey as CNKeyDescriptor,
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

  var rows: [IMsgRow] = []
  rows.reserveCapacity(Int(count))

  for idx in 0..<Int(count) {
    let item = handlesRaw!.advanced(by: idx).pointee
    guard let item else {
      return -1
    }

    let input = String(cString: item)
    let kind = imsgResolveKind(input)
    let canonical = imsgNormalize(input, kind)

    if kind == .im {
      rows.append(
        IMsgRow(
          found: false,
          ambiguous: false,
          kind: .im,
          input: input,
          name: nil,
          contactID: nil,
          canonical: canonical
        )
      )
      continue
    }

    var contacts: [CNContact] = []
    if kind == .email {
      contacts = byEmail[canonical.lowercased()] ?? []
    } else if kind == .phone {
      let digits = imsgPhoneDigits(canonical)
      if !digits.isEmpty {
        contacts = byPhoneFull[digits] ?? byPhoneTail[imsgPhoneTail(digits)] ?? []
      }
    }

    if contacts.isEmpty {
      rows.append(
        IMsgRow(
          found: false,
          ambiguous: false,
          kind: kind,
          input: input,
          name: nil,
          contactID: nil,
          canonical: canonical
        )
      )
      continue
    }

    let first = contacts[0]
    rows.append(
      IMsgRow(
        found: true,
        ambiguous: contacts.count > 1,
        kind: kind,
        input: input,
        name: imsgContactName(first),
        contactID: first.identifier,
        canonical: canonical
      )
    )
  }

  let result = IMsgResult(rows: rows)
  outRaw.pointee = UnsafeMutableRawPointer(Unmanaged.passRetained(result).toOpaque())
  return 0
}

@_cdecl("imsg_contacts_result_count")
public func imsg_contacts_result_count(_ resultRaw: UnsafeRawPointer?) -> u32 {
  guard let resultRaw else {
    return 0
  }

  let result = Unmanaged<IMsgResult>.fromOpaque(resultRaw).takeUnretainedValue()
  return u32(result.rows.count)
}

@_cdecl("imsg_contacts_result_input")
public func imsg_contacts_result_input(_ resultRaw: UnsafeRawPointer?, _ index: u32) -> UnsafePointer<CChar>? {
  guard let resultRaw else {
    return nil
  }

  let result = Unmanaged<IMsgResult>.fromOpaque(resultRaw).takeUnretainedValue()
  let idx = Int(index)

  if idx >= result.rows.count {
    return nil
  }

  return UnsafePointer(result.rows[idx].input)
}

@_cdecl("imsg_contacts_result_name")
public func imsg_contacts_result_name(_ resultRaw: UnsafeRawPointer?, _ index: u32) -> UnsafePointer<CChar>? {
  guard let resultRaw else {
    return nil
  }

  let result = Unmanaged<IMsgResult>.fromOpaque(resultRaw).takeUnretainedValue()
  let idx = Int(index)

  if idx >= result.rows.count {
    return nil
  }

  return UnsafePointer(result.rows[idx].name)
}

@_cdecl("imsg_contacts_result_contact_id")
public func imsg_contacts_result_contact_id(_ resultRaw: UnsafeRawPointer?, _ index: u32) -> UnsafePointer<CChar>? {
  guard let resultRaw else {
    return nil
  }

  let result = Unmanaged<IMsgResult>.fromOpaque(resultRaw).takeUnretainedValue()
  let idx = Int(index)

  if idx >= result.rows.count {
    return nil
  }

  return UnsafePointer(result.rows[idx].contactID)
}

@_cdecl("imsg_contacts_result_canonical")
public func imsg_contacts_result_canonical(_ resultRaw: UnsafeRawPointer?, _ index: u32) -> UnsafePointer<CChar>? {
  guard let resultRaw else {
    return nil
  }

  let result = Unmanaged<IMsgResult>.fromOpaque(resultRaw).takeUnretainedValue()
  let idx = Int(index)

  if idx >= result.rows.count {
    return nil
  }

  return UnsafePointer(result.rows[idx].canonical)
}

@_cdecl("imsg_contacts_result_found")
public func imsg_contacts_result_found(_ resultRaw: UnsafeRawPointer?, _ index: u32) -> u8 {
  guard let resultRaw else {
    return 0
  }

  let result = Unmanaged<IMsgResult>.fromOpaque(resultRaw).takeUnretainedValue()
  let idx = Int(index)

  if idx >= result.rows.count {
    return 0
  }

  return result.rows[idx].found
}

@_cdecl("imsg_contacts_result_ambiguous")
public func imsg_contacts_result_ambiguous(_ resultRaw: UnsafeRawPointer?, _ index: u32) -> u8 {
  guard let resultRaw else {
    return 0
  }

  let result = Unmanaged<IMsgResult>.fromOpaque(resultRaw).takeUnretainedValue()
  let idx = Int(index)

  if idx >= result.rows.count {
    return 0
  }

  return result.rows[idx].ambiguous
}

@_cdecl("imsg_contacts_result_match_kind")
public func imsg_contacts_result_match_kind(_ resultRaw: UnsafeRawPointer?, _ index: u32) -> u8 {
  guard let resultRaw else {
    return 0
  }

  let result = Unmanaged<IMsgResult>.fromOpaque(resultRaw).takeUnretainedValue()
  let idx = Int(index)

  if idx >= result.rows.count {
    return 0
  }

  return result.rows[idx].kind
}

@_cdecl("imsg_contacts_result_free")
public func imsg_contacts_result_free(_ resultRaw: UnsafeMutableRawPointer?) {
  guard let resultRaw else {
    return
  }

  Unmanaged<IMsgResult>.fromOpaque(resultRaw).release()
}
