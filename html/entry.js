
if (!global.jQuery) {
  global.jQuery = require('jquery');
}

require("../dist/index");

jQuery(function(){
  var $ = jQuery;
  var y = $("#container");
  var z = $("<div>JQuery is working?</div>").appendTo(y);
  z.plugin_functionality({
    html: "plugin is working",
    italic: true
  });
});
