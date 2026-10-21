/**
 * Player profiles: a unique player ID (handle) and a picture per player identity.
 * Browsers send their profile again on every connection, so profiles come back after a
 * server restart even without a data file.
 */
import { HANDLE_RE, MAX_PHOTO_CHARS, PRESET_AVATARS } from '../src/online/protocol';

export interface Profile { handle: string; pic: string | null; photo: Buffer | null; ver: number; level: number }

export class Profiles {
  private byId = new Map<string, Profile>();
  private handles = new Map<string, string>();

  /**
   * Save a player's picture and (optional) player ID. The picture is always kept, even when the
   * ID is refused. Returns an error message about the ID or the photo, or null.
   */
  set(id: string, rawHandle: string, avatar: string | null, level: number): string | null {
    let error: string | null = null;
    let pic: string | null = null;
    let photo: Buffer | null = null;
    if (typeof avatar === 'string' && avatar.startsWith('e:')) {
      const e = avatar.slice(2);
      if ((PRESET_AVATARS as readonly string[]).includes(e)) pic = `e:${e}`;
    } else if (typeof avatar === 'string' && avatar.startsWith('data:image/jpeg;base64,')) {
      const buf = avatar.length > MAX_PHOTO_CHARS ? null : Buffer.from(avatar.slice('data:image/jpeg;base64,'.length), 'base64');
      if (!buf) error = 'That photo is too large.';
      else if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) error = 'That photo could not be read.';
      else photo = buf;
    }
    const old = this.byId.get(id);
    let handle = String(rawHandle ?? '').toLowerCase();
    if (handle && !HANDLE_RE.test(handle)) { error = 'Player IDs use 3–16 letters, numbers or _.'; handle = ''; }
    const owner = handle ? this.handles.get(handle) : undefined;
    if (owner && owner !== id) { error = 'That player ID is taken. Try another one.'; handle = ''; }
    if (old?.handle && old.handle !== handle) this.handles.delete(old.handle);
    const same = old && old.photo && photo && old.photo.equals(photo);
    const ver = same ? old!.ver : (old?.ver ?? 0) + 1;
    if (photo) pic = `u:${ver}`;
    this.byId.set(id, { handle, pic, photo, ver, level: Math.max(1, Math.min(99, Math.floor(Number(level) || 1))) });
    if (handle) this.handles.set(handle, id);
    return error;
  }

  get(id: string): Profile | undefined { return this.byId.get(id); }
  photo(id: string): Buffer | null { return this.byId.get(id)?.photo ?? null; }

  snapshot() {
    return [...this.byId.entries()].map(([id, p]) => ({ id, handle: p.handle, pic: p.pic, photo: p.photo?.toString('base64') ?? null, ver: p.ver, level: p.level }));
  }
  restore(rows: ReturnType<Profiles['snapshot']>) {
    for (const r of rows ?? []) {
      this.byId.set(r.id, { handle: r.handle, pic: r.pic, photo: r.photo ? Buffer.from(r.photo, 'base64') : null, ver: r.ver, level: r.level });
      this.handles.set(r.handle, r.id);
    }
  }
}
