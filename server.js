// Entry point: `npm start`
const config = require('./backend/config');
const { openDatabase } = require('./backend/db/database');
const { createApp } = require('./backend/app');

const db = openDatabase(config.dbFile);
createApp(db).listen(config.port, () => {
  console.log(`Loan Track System running at http://localhost:${config.port}`);
});
