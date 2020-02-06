
// Require jQuery only if needed.
if (!global.jQuery) {
  global.jQuery = require('jquery');
}

// my_plugin installs itself into the global jQuery object
require("./my_plugin")

function hello_jest_is_loaded() {
  return true;
}

export default hello_jest_is_loaded;
