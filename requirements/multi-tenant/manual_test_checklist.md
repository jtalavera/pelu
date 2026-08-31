# Manual test checklist — feat/multi_tenant

> Everything introduced on this branch (HU-34 through HU-58, plus fixes made
> while implementing them), grouped by where to find it in the menu. See
> [PRD](prd_multi_tenant_management_v1.md) for full acceptance criteria per HU.

## Login & routing

- [X] Login as Platform Admin → lands on `/platform` — Login
- [X] Login as tenant Admin/Professional → lands on `/app` — Login
- [ ] Login to a 2nd (non-oldest) tenant with no custom domain still resolves to the right tenant — Login
- [ ] Wrong password / nonexistent email → identical generic error — Login
- [ ] Same email+password valid in 2 different tenants → distinct "linked to more than one business" error — Login
- [ ] Forgot-password for a non-oldest tenant's user actually sends the email now — Login → *Forgot your password?*

## Platform → Tenants

- [ ] Create tenant (name + tier)
- [ ] Edit tenant (name, domain, tier)
- [ ] Search/filter + pagination (10/25/50)
- [ ] Suspend tenant → its users can't log in
- [ ] Reactivate tenant → login works again
- [ ] Invite tenant admin → activation email sent
- [ ] Assign a 2nd admin to the same tenant
- [ ] Deactivate / reactivate a tenant user
- [ ] Resend invitation (not-yet-activated user)
- [ ] Trigger password reset (activated user who lost access)

## Platform → Tiers

- [ ] Create / edit a tier
- [ ] Associate feature flags to a tier
- [ ] Assign tier to a tenant (in create/edit tenant) → tenant inherits tier's flag defaults

## Platform → Feature flags

- [ ] Toggle a global default flag
- [ ] Set a per-tenant override
- [ ] Resolution order holds: global default → tier default → tenant override wins

## Platform → Data import

- [ ] Download example spreadsheet (services / clients / professionals)
- [ ] Import each entity from Excel
- [ ] Import report shows per-row success/failure; bad rows don't block good ones

## Femme-branding fix (this session)

- [ ] Tenant-admin invite email shows the tenant's real name, not "Femme" — Platform → Tenants
- [ ] Password-reset email shows the tenant's name — Platform → Tenants → reset a user
- [ ] Activation page (`/activate?token=…`) shows the tenant's name
- [ ] Tenant dashboard header shows the tenant's name — App → Dashboard
- [ ] Platform console header / Login / Forgot-password pages show a generic label, no "Femme"

## Not menu-testable

Deploy/boot-time only, skip unless doing a fresh-install check — HU-56/57/58:
no demo tenant auto-seeded on boot, Platform Admin bootstrap on an empty DB.
