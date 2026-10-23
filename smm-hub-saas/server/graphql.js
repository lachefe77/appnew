const {
  buildSchema,
  parse,
  validate,
  execute,
  specifiedRules,
  GraphQLError,
  visit,
} = require('graphql');
const { db } = require('./db');

const schema = buildSchema(`
  type Service { id: ID!, name: String!, platform: String, price_per_k_cents: Int!, min_quantity: Int!, max_quantity: Int!, refill_available: Int }
  type Category { id: ID!, name: String!, platform: String, icon: String }
  type Order { id: ID!, uuid: String!, status: String!, quantity: Int!, charge_cents: Int!, created_at: String! }
  type User { id: ID!, name: String!, email: String!, balance_cents: Int!, tier: String }
  type Query { services(limit: Int = 50): [Service!]!, categories: [Category!]!, myOrders(limit: Int = 25): [Order!]!, me: User }
`);

function boundedLimit(value, max) {
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new GraphQLError(`limit deve estar entre 1 e ${max}.`);
  return value;
}

function resolve(query, context = {}, variables, operationName) {
  if (typeof query !== 'string' || !query.trim() || query.length > 10000)
    return {
      errors: [{ message: 'Consulta inválida ou excede 10000 caracteres.' }],
    };
  if (
    variables !== undefined &&
    (!variables || typeof variables !== 'object' || Array.isArray(variables))
  )
    return { errors: [{ message: 'variables deve ser um objeto.' }] };
  try {
    const document = parse(query, { maxTokens: 1000 });
    let fields = 0;
    let forbidden = false;
    visit(document, {
      Field(node) {
        fields++;
      },
      FragmentSpread() {
        forbidden = true;
      },
      InlineFragment() {
        forbidden = true;
      },
    });
    if (
      fields > 100 ||
      forbidden ||
      document.definitions.filter((node) => node.kind === 'OperationDefinition')
        .length > 1
    )
      throw new GraphQLError(
        'Consulta excede o orçamento; use uma operação sem fragmentos com até 100 campos.'
      );
    const errors = validate(schema, document, specifiedRules);
    if (errors.length)
      return { errors: errors.map((error) => ({ message: error.message })) };
    const authenticated = () => {
      if (!context.userId) throw new GraphQLError('Autenticação necessária.');
      return context.userId;
    };
    const root = {
      services: ({ limit }) =>
        db
          .prepare(
            "SELECT id,name,platform,price_per_k_cents,min_quantity,max_quantity,refill_available FROM services WHERE status='active' ORDER BY id LIMIT ?"
          )
          .all(boundedLimit(limit, 100)),
      categories: () =>
        db
          .prepare(
            'SELECT id,name,platform,icon FROM categories ORDER BY sort_order,id LIMIT 100'
          )
          .all(),
      myOrders: ({ limit }) =>
        db
          .prepare(
            'SELECT id,uuid,status,quantity,charge_cents,created_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT ?'
          )
          .all(authenticated(), boundedLimit(limit, 50)),
      me: () =>
        db
          .prepare(
            'SELECT id,name,email,balance_cents,tier FROM users WHERE id=?'
          )
          .get(authenticated()),
    };
    return execute({
      schema,
      document,
      rootValue: root,
      variableValues: variables,
      operationName,
    });
  } catch (error) {
    return {
      errors: [
        {
          message:
            error instanceof GraphQLError
              ? error.message
              : 'Não foi possível executar a consulta.',
        },
      ],
    };
  }
}

module.exports = { resolve, schema };
