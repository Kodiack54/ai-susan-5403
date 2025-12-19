/**
 * Strip ANSI escape codes from strings
 */
function stripAnsi(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b/g, '');
}

module.exports = stripAnsi;
