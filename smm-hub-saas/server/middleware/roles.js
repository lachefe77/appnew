const { requireAuth } = require('../auth');

/**
 * Hierarquia de 5 cargos:
 *   user    (0) — cliente comum
 *   vip     (1) — cliente premium (acesso a serviços exclusivos)
 *   support (2) — equipe de suporte (vê tickets, não mexe em finanças)
 *   admin   (5) — gestor operacional (mexe em serviços/provedores/preços)
 *   ceo     (10) — dono (poderes totais, inclui mudar roles e deletar admins)
 *
 * Aliases legados: "usuario" → user, "suporte" → support, "finance"/"provider_manager" → admin.
 */
const ROLE_HIERARCHY = { user: 0, vip: 1, support: 2, admin: 5, ceo: 10 };
const ROLE_ALIASES = { usuario: 'user', suporte: 'support', finance: 'admin', provider_manager: 'admin' };
const VALID_ROLES = ['user', 'vip', 'support', 'admin', 'ceo'];

function normalizeRole(role) { return ROLE_ALIASES[role] || role || 'user'; }

function hasAtLeast(userRole, minRole) {
  return (ROLE_HIERARCHY[normalizeRole(userRole)] || 0) >= (ROLE_HIERARCHY[normalizeRole(minRole)] || 0);
}

function requireRole(minRole) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (!hasAtLeast(req.user.role, minRole)) {
        return res.status(403).json({ error: `Acesso restrito ao cargo: ${minRole} ou superior.` });
      }
      next();
    });
  };
}

module.exports = { requireRole, hasAtLeast, ROLE_HIERARCHY, VALID_ROLES, normalizeRole };
