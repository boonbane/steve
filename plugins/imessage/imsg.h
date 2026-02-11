#ifndef IMSG_H
#define IMSG_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
  IMSG_CONTACTS_AUTH_NOT_DETERMINED = 0,
  IMSG_CONTACTS_AUTH_DENIED = 1,
  IMSG_CONTACTS_AUTH_AUTHORIZED = 2
} imsg_contacts_auth_status_t;

typedef enum {
  IMSG_CONTACTS_MATCH_NONE = 0,
  IMSG_CONTACTS_MATCH_PHONE = 1,
  IMSG_CONTACTS_MATCH_EMAIL = 2,
  IMSG_CONTACTS_MATCH_IM = 3
} imsg_contacts_match_kind_t;

int32_t imsg_contacts_auth_status(void);
int32_t imsg_contacts_request_access(void);

int32_t imsg_contacts_resolve(
  const char *const *handles,
  uint32_t count,
  uint32_t flags,
  void **out
);

uint32_t imsg_contacts_result_count(const void *result);
const char *imsg_contacts_result_input(const void *result, uint32_t index);
const char *imsg_contacts_result_name(const void *result, uint32_t index);
const char *imsg_contacts_result_contact_id(const void *result, uint32_t index);
const char *imsg_contacts_result_canonical(const void *result, uint32_t index);
uint8_t imsg_contacts_result_found(const void *result, uint32_t index);
uint8_t imsg_contacts_result_ambiguous(const void *result, uint32_t index);
uint8_t imsg_contacts_result_match_kind(const void *result, uint32_t index);

void imsg_contacts_result_free(void *result);

#ifdef __cplusplus
}
#endif

#endif
