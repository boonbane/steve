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

int32_t imsg_contacts_auth_status(void);
int32_t imsg_contacts_request_access(void);

void* imsg_contacts_resolve(const char* const* handles, uint32_t count,
                            uint32_t* out_len);
void imsg_contacts_resolve_free(void* ptr);

void* imsg_contact_image(const char* identifier, uint32_t max_pixel, uint32_t* out_len);
void imsg_contact_image_free(void* ptr);

#ifdef __cplusplus
}
#endif

#endif
