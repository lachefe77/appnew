require('../server/db').initDB();
require('../server/extended-schema').applyExtendedSchema();
require('../server/extended-schema-v3').applyV3Schema();
require('../server/ops-desk').applySchema();
