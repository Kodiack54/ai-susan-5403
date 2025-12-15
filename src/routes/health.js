/**
 * Susan Health Routes
 */

const express = require('express');
const router = express.Router();
const config = require('../lib/config');

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'susan-librarian',
    port: config.PORT
  });
});

module.exports = router;
