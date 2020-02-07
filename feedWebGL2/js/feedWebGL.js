
// jQuery plugin for webGL feedback programs.

(function($) {
    $.fn.feedWebGL2 = function (options) {
        var jquery_object = this;

        class FeedbackContext {
            
            constructor(options) {
                this.settings = $.extend({
                    // default settings:
                    gl: null,    // the underlying gl context to use
                }, options);

                var canvas = null;
                var gl = this.settings.gl;
                if (!gl) {
                    // create a webgl context
                    var canvas = document.createElement( 'canvas' ); 
                    gl = canvas.getContext( 'webgl2', { alpha: false } ); 
                }
                this.gl = gl;
                this.canvas = canvas;
                this.counter = 0;
                this.buffers = {};
                this.programs = {};
                this.error = null;
            };
            fresh_name(prefix) {
                this.counter += 1;
                return prefix + this.counter;
            }
            buffer(name, bytes_per_element) {
                name = name || this.fresh_name("buffer");
                var buffer = new FeedbackBuffer(this, name, bytes_per_element);
                this.buffers[name] = buffer;
                return buffer;
            };
            program(options) {
                var prog = new FeedbackProgram(this, options);
                this.programs[prog.name] = prog;
                return prog;
            };
        };

        var noop_fragment_shader = `#version 300 es
        #ifdef GL_ES
            precision highp float;
        #endif
        
        out vec4 color;

        void main() {
            color = vec4(1.0, 0.0, 0.0, 1.0);
        }
        `;

        class FeedbackProgram {
            constructor(context, options) {
                this.settings = $.extend({
                    // default settings:
                    name: null,
                    vertex_shader: null,
                    fragment_shader: noop_fragment_shader,
                    run_type: "POINTS",   // run glsl program point by point (not triangles or lines, default)
                    feedbacks: {
                        "gl_Position": {
                            num_components: 4,
                            bytes_per_component: 4,
                        },
                    },
                    compile_now: true
                }, options);
                if (!this.settings.vertex_shader) {
                    throw new Error("feedback program requires a vertex shader.");
                }
                this.error = null;
                this.context = context;
                this.name = this.settings.name || context.fresh_name("program");
                // preprocess the feedbacks
                this.feedbacks_by_name = {};
                this.feedback_order = [];
                this.runners = {};
                for (var name in this.settings.feedbacks) {
                    var feedback_desc = this.settings.feedbacks[name];
                    var feedback = new FeedbackVariable(this, name, feedback_desc.num_components, feedback_desc.bytes_per_component);
                    this.feedbacks_by_name[name] = feedback;
                    this.feedback_order.push(feedback);
                    feedback.index = this.feedback_order.length - 1;
                }
                // compile program in separate step for easy testing.
                this.gl_program = null;
                if (this.settings.compile_now) {
                    this.compile();
                }
            };
            runner(num_instances, vertices_per_instance, name, run_type) {
                name = name || this.context.fresh_name("runner");
                run_type = run_type || this.settings.run_type;
                vertices_per_instance = vertices_per_instance || 1;
                var run = new FeedbackRunner(this, num_instances, vertices_per_instance, name, run_type);
                this.runners[run.name] = run;
                return run;
            };
            feedback_variables() {
                return this.feedback_order.map(x => x.name);
            }
            compile() {
                var context = this.context;
                var gl = context.gl;
                var vertex_shader_code = this.settings.vertex_shader;
                var fragment_shader_code = this.settings.fragment_shader;
                this.gl_program = context.gl.createProgram();
                // compile shaders
                this.vertex_shader = this.compileShader(vertex_shader_code, gl.VERTEX_SHADER);
                this.fragment_shader = this.compileShader(fragment_shader_code, gl.FRAGMENT_SHADER);
                // set up feedbacks...
            };
            check_error() {
                if (this.error) {
                    throw new Error("previous error: " + this.error);
                }
            };
            compileShader(code, type) {
                this.check_error();
                var gl = this.context.gl;
                var program = this.gl_program;
                let shader = gl.createShader(type);
                gl.shaderSource(shader, code);
                gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                    var err = `Error compiling ${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} shader:`;
                    console.log(err);
                    console.log(gl.getShaderInfoLog(shader));
                    this.error = err;
                    throw new Error(err);
                } else {
                    gl.attachShader(program, shader);
                }
                return shader;
            };
        };

        class FeedbackRunner {
            constructor(program, num_instances, vertices_per_instance, name, run_type) {
                this.program = program;
                this.vertices_per_instance = vertices_per_instance;
                this.num_instances = num_instances;
                this.name = name;
                this.run_type = run_type;
            }
        };

        class FeedbackBuffer {
            constructor(context, name, bytes_per_element) {
                this.context = context;
                this.name = name;
                this.bytes_per_element = bytes_per_element;
                this.buffer = context.gl.createBuffer();
            };
        };

        class FeedbackVariable {
            constructor(program, name, num_components, bytes_per_component) {
                this.program = program;
                this.name = name;
                this.num_components = num_components || 1;
                this.bytes_per_component = bytes_per_component || 4;
            };
        };

        return new FeedbackContext(options);
    }
})(jQuery);
