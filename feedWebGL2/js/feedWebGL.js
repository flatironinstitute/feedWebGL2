
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
                    uniforms: {
                        //"translation": {
                        //    // https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/unifor
                        //    vtype: "4fv",
                        //    default_value: [-1, -1, -1, 0],
                        //},
                        //"affine_transform": {
                        //    // https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/unifor
                        //    vtype: "4fv",
                        //    is_matrix: true,
                        //    default_value: [0,1,0,0, 1,0,0,0, 0,0,1,0, 0,0,0,1, ],
                        //},
                    },
                    inputs: {
                    //    "location": {
                    //        num_components: 3,
                    //    },
                    //    "scale": {},  // implicitly just one component
                    //    "point_offset":  {
                    //        per_vertex: true,  // repeat for every mesh
                    //        num_components: 3,
                    //    }
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
                // preprocess the uniforms defined for the program
                var uniform_descriptions = program.settings.uniforms;
                this.uniforms = {};
                for (var name in uniform_descriptions) {
                    var desc = uniform_descriptions[name];
                    var uniform = null;
                    if (desc.is_matrix) {
                        uniform = new MatrixUniform(this, name, desc.vtype, desc.default_value);
                    } else {
                        uniform = new VectorUniform(this, name, desc.vtype, desc.default_value);
                    }
                    this.uniforms[name] = uniform;
                }
                // preprocess instance inputs defined for the program
                this.inputs = {};
                var input_descriptions = program.settings.inputs;
                for (var name in input_descriptions) {
                    var desc = input_descriptions[name];
                    var input = null;
                    if (desc.per_vertex) {
                        input = new VertexInput(this, name, desc.num_components);
                    } else {
                        input = new MeshInput(this, name, desc.num_components);
                    }
                    this.inputs[name] = input;
                }
            }
        };

        class FeedbackBuffer {
            constructor(context, name, bytes_per_element) {
                this.context = context;
                this.name = name;
                this.bytes_per_element = bytes_per_element || 4;
                this.buffer = context.gl.createBuffer();
                this.byte_size = null;
                this.num_elements = null;
            };
            initialize_from_array(array) {
                if (this.bytes_per_element != array.BYTES_PER_ELEMENT) {
                    throw new Error("byte per element must match " + this.bytes_per_element + " <> " + array.BYTES_PER_ELEMENT);
                }
                this.num_elements = array.length;
                this.byte_size = this.bytes_per_element * this.num_elements;
                var gl = this.context.gl;
                gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
                gl.bufferData(gl.ARRAY_BUFFER, this.byte_size, gl.DYNAMIC_COPY);  //  ?? dynamic copy??
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
            }
            allocate_size(num_elements) {
                this.num_elements = num_elements;
                this.byte_size = this.bytes_per_element * num_elements;
                var gl = this.context.gl;
                gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
                gl.bufferData(gl.ARRAY_BUFFER, this.byte_size, gl.DYNAMIC_COPY);  //  ?? dynamic copy??
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
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

        class VectorUniform {
            constructor (runner, name, vtype, default_value) {
                this.runner = runner;
                this.name = name;
                this.vtype = vtype;
                this.value = default_value;
            };
            is_matrix() {
                return false;  // mainly for testing
            };
        };

        class MatrixUniform extends VectorUniform {
            // xxxxx
            is_matrix() {
                return true;  // mainly for testing
            };
        };

        class MeshInput {
            constructor (runner, name, num_components) {
                this.runner = runner;
                this.name = name;
                this.num_components = num_components || 1;
            };
            is_mesh_input() {
                return true;  // mainly for testing
            };
        };

        class VertexInput extends MeshInput {
            is_mesh_input() {
                return false;  // mainly for testing
            };
        };

        return new FeedbackContext(options);
    }
})(jQuery);
