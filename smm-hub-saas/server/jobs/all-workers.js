const domain = require('../automation-domain');
const { startLeased } = require('../worker-lease');
function startScheduledWorker() {
  return startLeased('scheduled-orders', domain.scheduledTick, 60000);
}
function startAutopilotWorker() {
  return startLeased('autopilot', domain.autopilotTick, 3600000);
}
function startContractsWorker() {
  return startLeased('recurring-contracts', domain.contractsTick, 3600000);
}
module.exports = {
  startScheduledWorker,
  startAutopilotWorker,
  startContractsWorker,
  isUserOnVacation: domain.isUserOnVacation,
};
