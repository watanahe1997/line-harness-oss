import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { richMenus } from './rich-menus.js';

const uploadRichMenuImage = vi.fn();
const getDefaultRichMenuId = vi.fn();

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({
    uploadRichMenuImage,
    getDefaultRichMenuId,
  })),
}));

describe('POST /api/rich-menus/:id/image', () => {
  function setupApp() {
    const app = new Hono<{
      Bindings: {
        DB: D1Database;
        LINE_CHANNEL_ACCESS_TOKEN: string;
      };
    }>();
    app.route('/', richMenus);
    return app;
  }

  beforeEach(() => {
    uploadRichMenuImage.mockReset();
    uploadRichMenuImage.mockResolvedValue(undefined);
    getDefaultRichMenuId.mockReset();
  });

  test('reads back the actual default menu, including an unset default', async () => {
    const app = setupApp();
    getDefaultRichMenuId.mockResolvedValueOnce('richmenu-current').mockResolvedValueOnce(null);
    const env = { LINE_CHANNEL_ACCESS_TOKEN: 'token', DB: {} as D1Database };
    expect(await (await app.request('/api/rich-menus/default', {}, env)).json()).toEqual({
      success: true, data: { richMenuId: 'richmenu-current' },
    });
    expect(await (await app.request('/api/rich-menus/default', {}, env)).json()).toEqual({
      success: true, data: { richMenuId: null },
    });
  });

  test('does not mistake a LINE API failure for an unset default', async () => {
    getDefaultRichMenuId.mockRejectedValue(new Error('upstream unavailable'));
    expect((await setupApp().request('/api/rich-menus/default', {}, {
      LINE_CHANNEL_ACCESS_TOKEN: 'token', DB: {} as D1Database,
    })).status).toBe(502);
  });

  test('accepts SDK imageData JSON field for base64 uploads', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menus/richmenu-1/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        imageData: 'aGVsbG8=',
        contentType: 'image/png',
      }),
    }, {
      LINE_CHANNEL_ACCESS_TOKEN: 'token',
      DB: {} as D1Database,
    });

    expect(res.status).toBe(200);
    expect(uploadRichMenuImage).toHaveBeenCalledTimes(1);
    const [richMenuId, imageData, contentType] = uploadRichMenuImage.mock.calls[0];
    expect(richMenuId).toBe('richmenu-1');
    expect(contentType).toBe('image/png');
    expect(new TextDecoder().decode(imageData as ArrayBuffer)).toBe('hello');
  });

  test('keeps accepting legacy image JSON field', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menus/richmenu-2/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        image: 'data:image/jpeg;base64,aGVsbG8=',
        contentType: 'image/jpeg',
      }),
    }, {
      LINE_CHANNEL_ACCESS_TOKEN: 'token',
      DB: {} as D1Database,
    });

    expect(res.status).toBe(200);
    expect(uploadRichMenuImage).toHaveBeenCalledTimes(1);
    const [richMenuId, imageData, contentType] = uploadRichMenuImage.mock.calls[0];
    expect(richMenuId).toBe('richmenu-2');
    expect(contentType).toBe('image/jpeg');
    expect(new TextDecoder().decode(imageData as ArrayBuffer)).toBe('hello');
  });
});
