"""
Quick and dirty raw widget interface for running feedback programs
in a Jupyter widget.
"""

from . import local_files
import numpy as np
import jp_proxy_widget
from jp_doodle import dual_canvas
from jp_doodle.data_tables import widen_notebook

required_javascript_modules = [
    local_files.vendor_path("js/feedWebGL.js"),
]

REQUIREMENTS_LOADED = False

def load_requirements(widget=None, silent=True, additional=()):
    """
    Load Javascript prerequisites into the notebook page context.
    """
    global REQUIREMENTS_LOADED
    if REQUIREMENTS_LOADED:
        if not silent:
            print("Not reloading requirements.")
        return
    if widget is None:
        widget = jp_proxy_widget.JSProxyWidget()
        silent = False
    # Make sure jQuery and jQueryUI are loaded.
    widget.check_jquery()
    # load additional jQuery plugin code.
    all_requirements = list(required_javascript_modules) + list(additional)
    widget.load_js_files(all_requirements)
    dual_canvas.load_requirements(widget, silent=silent)
    if not silent:
        widget.element.html("<div>Requirements for <b>feedback program</b> have been loaded.</div>")
        display(widget)
    REQUIREMENTS_LOADED = True


class FeedbackProgram(jp_proxy_widget.JSProxyWidget):

    #run_count = 0

    def __init__(self, context, program, runner, *pargs, **kwargs):
        super(FeedbackProgram, self).__init__(*pargs, **kwargs)
        load_requirements(self)
        self.element.html("Uninitialized Feedback Program Widget.")
        self.js_init("""
            debugger;
            var width = context.width || 100;
            var height = context.height || width;
            element.canvas = $(`<canvas width="${width}" height="${height}">Oh no! Your browser doesn't support canvas!</canvas>`);
            element.gl = element.canvas[0].getContext("webgl2");
            if (context.show) {
                element.empty();
                element.canvas.css("background", "#cdcdcd");
                element.canvas.appendTo(element);
                runner.rasterize = true; // alway rasterize if show is true.
                // disable face culling
                //element.gl.disable(element.gl.CULL_FACE);
                element.gl.enable(element.gl.DEPTH_TEST);
            }
            var context_description = $.extend({
                gl: element.gl,
            }, context);
            element.feedback_context = element.feedWebGL2(context_description);
            element.feedback_program = element.feedback_context.program(program);
            element.feedback_runner = element.feedback_program.runner(runner);

            element.get_feedback = function(name) {
                var typed = element.feedback_runner.feedback_vectors(name);
                return Array.from(typed);
            };

            element.change_uniform_vector = function(name, vector_value) {
                element.feedback_runner.change_uniform(name, vector_value);
            };

            element.run_count = 0;

            element.run_feedback_program = function() {
                element.run_count += 1;
                if (context.show) {
                    // xxxx should make these settings adjustable...
                    var gl = element.gl;
                    gl.viewport(0, 0, width, height);
                    gl.clearColor(0.0, 0.0, 0.0, 1.0);
                    gl.clear(gl.COLOR_BUFFER_BIT);
                } else {
                    element.html("Program run: " +  element.run_count)
                }
                return element.feedback_runner.run();    
            };

            element.change_buffer = function(buffer_name, array) {
                var buffer = element.feedback_context.get_buffer(buffer_name);
                buffer.copy_from_array(array);
            };

            if (!context.show) {
                element.html("Feedback program initialized");
            }
        """, context=context, program=program, runner=runner)

    def run(self):
        self.element.run_feedback_program()
        #self.run_count += 1
        #self.element.html("program run: " + repr(self.run_count))

    def change_uniform_vector(self, name, vector_value):
        self.element.change_uniform_vector(name, list(vector_value))
    
    def get_feedback(self, name):
        return self.element.get_feedback(name).sync_value()

    def change_buffer(self, buffer_name, array):
        array = np.array(array)
        sequence = array.ravel().tolist()
        self.element.change_buffer(buffer_name, sequence)

# These are placeholders -- eventually replace them with better validators
Context = dict
Buffer = dict
Buffers = dict
Program = dict
Runner = dict
Feedbacks = dict
Feedback = dict
Uniforms = dict
Uniform = dict
Inputs = dict
Input = dict
Sampler = dict
Samplers = dict
Texture = dict
Textures = dict
BufferLocation = dict

