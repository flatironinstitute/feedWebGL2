
if (!global.jQuery) {
  global.jQuery = require('jquery');
}

require("../dist/index");

var runr, d;  // keep context

/*
jQuery(function(){
  debugger;
  var $ = jQuery;
  var d = $("#container");
  //var runr = jQuery.fn.feedWebGL2.trivial_example(d);
  //var runr = jQuery.fn.feedWebGL2.example(d);
  //var contour = jQuery.fn.webGL2surfaces3d.simple_example(d);
  //var test = $.fn.streamLiner.example(d);
  //var test = $.fn.webGL2MarchingCubes.example(d);
  var test = $.fn.volume32.example(d);
});
*/

function main_test_program() {

    debugger;
    var $ = jQuery;
    d = $("#container");
    //var runr = jQuery.fn.feedWebGL2.trivial_example(d);
    //var runr = jQuery.fn.feedWebGL2.example(d);
    //var contour = jQuery.fn.webGL2surfaces3d.simple_example(d);
    //var test = $.fn.streamLiner.example(d);
    //var test = $.fn.webGL2MarchingCubes.example(d);
    var test = $.fn.volume32.example(d);

}

window.main_test_program = main_test_program;
/*
helpful console snippet:

var gl = runr.program.context.gl;
var program = runr.program.gl_program;

const numAttribs = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
for (let ii = 0; ii < numAttribs; ++ii) {
  const attribInfo = gl.getActiveAttrib(program, ii);
  const index = gl.getAttribLocation(program, attribInfo.name);
  console.log(index, attribInfo.name);
}
*/