export function buildOpenApi(router, { title = 'UTAX Finance CRM API', version = '1.0.0' } = {}) {
  const paths = {};
  const tags = new Set();
  for (const r of router.routes) {
    const p = r.path.replace(/:([a-zA-Z_]+)/g, '{$1}');
    paths[p] ??= {};
    const params = r.keys.map((k) => ({ name: k, in: 'path', required: true, schema: { type: 'string' } }));
    const o = r.opts || {};
    (o.tags || []).forEach((t) => tags.add(t));
    paths[p][r.method.toLowerCase()] = {
      summary: o.summary || `${r.method} ${r.path}`,
      tags: o.tags || ['misc'],
      parameters: [...params, ...(o.query || []).map((q) => ({ name: q, in: 'query', schema: { type: 'string' } }))],
      ...(o.body ? { requestBody: { content: { 'application/json': { schema: o.body } } } } : {}),
      security: o.auth === false ? [] : [{ bearerAuth: [] }],
      'x-permission': o.perm ? `${o.perm[0]}.${o.perm[1]}` : undefined,
      responses: { 200: { description: 'OK' }, 400: { description: 'Bad request' }, 401: { description: 'Unauthorized' }, 403: { description: 'Forbidden' } },
    };
  }
  return {
    openapi: '3.0.3',
    info: { title, version, description: 'API-first Finance Operating System. Contract → Payment → Revenue Recognition → Expense → Receivable → Cash → Profit.' },
    servers: [{ url: '/' }],
    tags: [...tags].map((t) => ({ name: t })),
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    paths,
  };
}
