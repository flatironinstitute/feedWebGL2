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

    run_count = 0

    def __init__(self, context, program, runner, *pargs, **kwargs):
        super(FeedbackProgram, self).__init__(*pargs, **kwargs)
        load_requirements(self)
        self.element.html("Uninitialized Feedback Program Widget.")
        self.js_init("""
            element.canvas = $('<canvas width="100" height="100"></canvas>');
            element.gl = element.canvas[0].getContext("webgl2");
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

            element.html("Feedback program initialized");
        """, context=context, program=program, runner=runner)

    def run(self):
        self.element.feedback_runner.run().sync_value()
        self.run_count += 1
        self.element.html("program run: " + repr(self.run_count))
    
    def get_feedback(self, name):
        return self.element.get_feedback(name).sync_value()

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
BufferLocation = dict

