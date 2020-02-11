
if (!global.jQuery) {
  global.jQuery = require('jquery');
}

require("../dist/index");

jQuery(function(){
  debugger;
  var $ = jQuery;
  var d = $("#container");
  var runr = jQuery.fn.feedWebGL2.example(d);
});
