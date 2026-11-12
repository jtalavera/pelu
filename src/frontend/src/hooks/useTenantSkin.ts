import { useEffect } from "react";

/** Skin names the backend may send (TenantSkin enum); each has a block in styles/skins.css. */
const KNOWN_SKINS = new Set(["durazno", "celeste", "rosa"]);

/**
 * Applies the tenant's skin by setting `data-skin` on <html> (see styles/skins.css: the accent
 * variables change, the rest of the palette does not). Unknown, missing or null values (including
 * the tenant-less Platform Admin) fall back to the default look, which is `durazno` anyway, and the
 * attribute is removed when the shell unmounts so the login screen is never skinned.
 */
export function useTenantSkin(skin: string | null | undefined): void {
  useEffect(() => {
    const root = document.documentElement;
    const name = skin?.toLowerCase();
    if (name && KNOWN_SKINS.has(name)) {
      root.dataset.skin = name;
    } else {
      delete root.dataset.skin;
    }
    return () => {
      delete root.dataset.skin;
    };
  }, [skin]);
}
