require('dotenv').config();
const app = require('./app');
const schedulerService = require('./services/schedulerService');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Hospital chatbot server listening on port ${PORT}`));
schedulerService.start();
