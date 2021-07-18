
// Require jQuery only if needed.
if (!global.jQuery) {
  global.jQuery = require('jquery');
}

// The plugins install themselves into the global jQuery object
require("./feedWebGL");
require("./feedbackContours");
require("./feedbackSurfaces");
require("./feedbackMatrix");
require("./volume32");
require("./metric_clusterer");
require("./metric_generator");
require("./attract_repel_clusterer");
require("./streamLiner");
require("./feedbackMarchingCubes");

// TEMPORARY HACK -- JP_DOODLE SHOULD BE INSTALLED BY NPM
require("./canvas_2d_widget_helper.js")
require("./dual_canvas_helper.js")

function feedWebGL_is_loaded() {
  return true;
}

export default feedWebGL_is_loaded;
