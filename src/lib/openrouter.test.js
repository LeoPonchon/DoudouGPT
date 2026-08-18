jest.mock('./mediaVision', () => ({
  analyzeAttachmentsWithVision: jest.fn(),
}));

const ENV_KEYS = [
  'REACT_APP_OPENROUTER_API_KEY',
  'REACT_APP_OPENROUTER_MODEL',
  'REACT_APP_OPENROUTER_FALLBACK_MODEL',
  'REACT_APP_OPENROUTER_APP_TITLE',
  'REACT_APP_OPENROUTER_SITE_URL',
];

const originalFetch = global.fetch;

function setOpenRouterEnv() {
  process.env.REACT_APP_OPENROUTER_API_KEY = 'test-openrouter-key';
  process.env.REACT_APP_OPENROUTER_MODEL = 'z-ai/glm-4.5-air:free';
  delete process.env.REACT_APP_OPENROUTER_FALLBACK_MODEL;
  process.env.REACT_APP_OPENROUTER_APP_TITLE = 'DoudouGPT';
  process.env.REACT_APP_OPENROUTER_SITE_URL = 'http://localhost:3000';
}

function restoreEnv(backup) {
  ENV_KEYS.forEach((key) => {
    if (typeof backup[key] === 'undefined') {
      delete process.env[key];
      return;
    }

    process.env[key] = backup[key];
  });
}

function createRateLimitResponse() {
  return {
    ok: false,
    status: 429,
    text: jest.fn().mockResolvedValue(
      JSON.stringify({
        error: {
          message: 'Provider returned error',
          code: 429,
          metadata: {
            provider_name: 'Z.AI',
          },
        },
      }),
    ),
  };
}

function createUnsupportedImageResponse() {
  return {
    ok: false,
    status: 400,
    text: jest.fn().mockResolvedValue(
      JSON.stringify({
        error: {
          message: 'This model does not support image inputs.',
          code: 400,
        },
      }),
    ),
  };
}

function createNotFoundResponse() {
  return {
    ok: false,
    status: 404,
    text: jest.fn().mockResolvedValue(
      JSON.stringify({
        error: {
          message: 'Provider route not found.',
          code: 404,
        },
      }),
    ),
  };
}

function createSuccessResponse(content) {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content,
          },
        },
      ],
    }),
  };
}

describe('sendOpenRouterChat', () => {
  let envBackup;

  beforeEach(() => {
    envBackup = {};
    ENV_KEYS.forEach((key) => {
      envBackup[key] = process.env[key];
    });

    setOpenRouterEnv();
    global.fetch = jest.fn();
    jest.resetModules();
  });

  afterEach(() => {
    restoreEnv(envBackup);
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test('falls back to openrouter/free when the configured model is rate limited', async () => {
    const { sendOpenRouterChat } = require('./openrouter');

    global.fetch
      .mockResolvedValueOnce(createRateLimitResponse())
      .mockResolvedValueOnce(createSuccessResponse('Salut !'));

    await expect(
      sendOpenRouterChat([
        {
          role: 'user',
          content: 'bonjour',
        },
      ]),
    ).resolves.toBe('Salut !');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({
      model: 'z-ai/glm-4.5-air:free',
    });
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toMatchObject({
      model: 'openrouter/free',
    });
  });

  test('returns a friendly error when the fallback model is also rate limited', async () => {
    const { sendOpenRouterChat } = require('./openrouter');

    global.fetch
      .mockResolvedValueOnce(createRateLimitResponse())
      .mockResolvedValueOnce(createRateLimitResponse());

    await expect(
      sendOpenRouterChat([
        {
          role: 'user',
          content: 'bonjour',
        },
      ]),
    ).rejects.toThrow(
      "Le modele free d'OpenRouter est temporairement sature. Reessaie dans quelques instants.",
    );
  });

  test('sends image attachments directly when the model supports them', async () => {
    const { analyzeAttachmentsWithVision } = require('./mediaVision');
    const { sendOpenRouterChat } = require('./openrouter');

    analyzeAttachmentsWithVision.mockReset();
    global.fetch.mockResolvedValueOnce(createSuccessResponse('Salut avec image !'));

    await expect(
      sendOpenRouterChat([
        {
          role: 'user',
          content: 'regarde ca',
          metadata: {
            hasText: true,
            attachments: [
              {
                id: 'attachment-1',
                name: 'sticker.png',
                mimeType: 'image/png',
                size: 1234,
                dataUrl: 'data:image/png;base64,AAAA',
              },
            ],
          },
        },
      ]),
    ).resolves.toBe('Salut avec image !');

    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);

    expect(requestBody.messages[1].content).toHaveLength(2);
    expect(requestBody.messages[1].content[0]).toMatchObject({
      type: 'text',
      text: 'regarde ca',
    });
    expect(requestBody.messages[1].content[1]).toMatchObject({
      type: 'image_url',
      image_url: {
        url: 'data:image/png;base64,AAAA',
      },
    });
    expect(analyzeAttachmentsWithVision).not.toHaveBeenCalled();
  });

  test('falls back to external vision analysis when the model cannot read attachments', async () => {
    const { analyzeAttachmentsWithVision } = require('./mediaVision');
    const { sendOpenRouterChat } = require('./openrouter');

    analyzeAttachmentsWithVision.mockReset();
    analyzeAttachmentsWithVision.mockResolvedValue([
      {
        id: 'attachment-1',
        summary: 'sticker.png: Labels: cat, sticker.',
        labels: ['cat', 'sticker'],
        text: '',
      },
    ]);

    global.fetch
      .mockResolvedValueOnce(createUnsupportedImageResponse())
      .mockResolvedValueOnce(createSuccessResponse('J ai vu le sticker.'));

    await expect(
      sendOpenRouterChat([
        {
          role: 'user',
          content: 'regarde ca',
          metadata: {
            hasText: true,
            attachments: [
              {
                id: 'attachment-1',
                name: 'sticker.png',
                mimeType: 'image/png',
                size: 1234,
                dataUrl: 'data:image/png;base64,AAAA',
              },
            ],
          },
        },
      ]),
    ).resolves.toBe('J ai vu le sticker.');

    expect(analyzeAttachmentsWithVision).toHaveBeenCalledTimes(1);
    expect(analyzeAttachmentsWithVision).toHaveBeenCalledWith([
      {
        id: 'attachment-1',
        name: 'sticker.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,AAAA',
        size: 1234,
      },
    ]);

    const fallbackRequestBody = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(fallbackRequestBody.messages[1].content).toContain('Pieces jointes :');
    expect(fallbackRequestBody.messages[1].content).toContain('sticker.png: Labels: cat, sticker.');
  });

  test('falls back to external vision analysis when OpenRouter returns 404 for an image request', async () => {
    const { analyzeAttachmentsWithVision } = require('./mediaVision');
    const { sendOpenRouterChat } = require('./openrouter');

    analyzeAttachmentsWithVision.mockReset();
    analyzeAttachmentsWithVision.mockResolvedValue([
      {
        id: 'attachment-1',
        summary: 'sticker.png: Tags: cat, sticker.',
        labels: ['cat', 'sticker'],
        text: '',
      },
    ]);

    global.fetch
      .mockResolvedValueOnce(createNotFoundResponse())
      .mockResolvedValueOnce(createSuccessResponse('J ai vu le sticker.'));

    await expect(
      sendOpenRouterChat([
        {
          role: 'user',
          content: 'regarde ca',
          metadata: {
            hasText: true,
            attachments: [
              {
                id: 'attachment-1',
                name: 'sticker.png',
                mimeType: 'image/png',
                size: 1234,
                dataUrl: 'data:image/png;base64,AAAA',
              },
            ],
          },
        },
      ]),
    ).resolves.toBe('J ai vu le sticker.');

    expect(analyzeAttachmentsWithVision).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
