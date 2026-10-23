const test = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path');
test('OpenAPI é estruturalmente válido e descreve contratos atuais de identidade', async () => {
  const api = await require('@apidevtools/swagger-parser').validate(
    path.join(__dirname, '../openapi.yaml'),
    { resolve: { external: false } }
  );
  const registration =
    api.paths['/api/auth/register'].post.requestBody.content['application/json']
      .schema;
  assert.equal(registration.properties.password.minLength, 12);
  assert.ok(registration.required.includes('consent_terms'));
  assert.equal(api.paths['/metrics'].get.parameters[0].in, 'header');
  assert.ok(api.paths['/api/graphql']);
});
