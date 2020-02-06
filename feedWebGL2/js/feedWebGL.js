
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
                    feedbacks: {
                        "gl_Position": {
                            num_components: 4,
                            bytes_per_component: 4,
                        },
                    },
                }, options);
                if (!options.vertex_shader) {
                    throw new Error("feedback program requires a vertex shader.");
                }
                this.context = context;
                this.name = this.settings.name || context.fresh_name("program");
                this.vertex_shader = this.settings.vertex_shader;
                this.fragment_shader = this.settings.fragment_shader;
                this.gl_program = context.gl.createProgram();
                // set up feedbacks...
            };
            compileShader(code, type) {
                this.check_error();
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
                    gl.attachShader(this.program, shader);
                }
                return shader;
            };
        };

        class FeedbackBuffer {
            constructor(context, name, bytes_per_element) {
                this.context = context;
                this.name = name;
                this.bytes_per_element = bytes_per_element;
                this.buffer = context.gl.createBuffer();
            };
        };

        return new FeedbackContext(options);
    }
})(jQuery);
