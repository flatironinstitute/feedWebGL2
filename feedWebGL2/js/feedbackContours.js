
/*

JQuery plugin populating 2 and 3 dimensional contours.

Requires nd_frame to be loaded.

Structure follows: https://learn.jquery.com/plugins/basic-plugin-creation/

*/
"use strict";

(function($) {

    $.fn.webGL2contours2d = function (options) {
        // from grid of sample points generate contour line segments

        class WebGL2Contour2d {
            constructor(options) {
                this.settings = $.extend({
                    // default settings:
                    feedbackContext: null,    // the underlying FeedbackContext context to use
                    valuesArray: null,   // the array buffer of values to contour
                    num_rows: null,
                    num_cols: null,
                    num_layers: 1,  // default to "flat"
                    dx: [1, 0, 0],
                    dy: [0, 1, 0],
                    dz: [0, 0, 1],
                    translation: [-1, -1, 0],
                    color: [1, 1, 1],
                    rasterize: false,
                    threshold: 0,  // value at contour
                    invalid_coordinate: -100000,  // invalidity marker for positions
                    after_run_callback: null,   // call this after each run.
                }, options);
                var s = this.settings;
                this.feedbackContext = s.feedbackContext;
                if (!this.feedbackContext) {
                    throw new Error("Feedback context required.");
                }
                var nvalues = s.valuesArray.length;
                var nvoxels = s.num_rows * s.num_cols * s.num_layers;
                if (nvalues != nvoxels) {
                    // for now strict checking
                    throw new Error("voxels " + nvoxels + " don't match values " + nvalues);
                }
                // allocate and load buffer with a fresh name
                this.buffer = this.feedbackContext.buffer()
                this.buffer.initialize_from_array(s.valuesArray);
                var buffername = this.buffer.name;

                this.program = this.feedbackContext.program({
                    vertex_shader: contour_vertex_shader,
                    fragment_shader: contour_fragment_shader,
                    feedbacks: {
                        vPosition: {num_components: 3},
                    },
                })
                var x_offset = 1;
                var y_offset = s.num_cols;
                //var z_offset = s.num_cols * s.num_rows;
                var num_instances = nvalues - (x_offset + y_offset);
                this.runner = this.program.runner({
                    run_type: "LINES",
                    num_instances: num_instances,
                    vertices_per_instance: 4,  // 2 endpoints each for 2 triangles.
                    rasterize: s.rasterize,
                    uniforms: {
                        uRowSize: {
                            vtype: "1iv",
                            default_value: [s.num_cols],
                        },
                        uColSize: {
                            vtype: "1iv",
                            default_value: [s.num_rows],
                        },
                        uValue: {
                            vtype: "1fv",
                            default_value: [s.threshold],
                        },
                        dx: {
                            vtype: "3fv",
                            default_value: s.dx,
                        },
                        dy: {
                            vtype: "3fv",
                            default_value: s.dy,
                        },
                        dz: {
                            vtype: "3fv",
                            default_value: s.dz,
                        },
                        translation: {
                            vtype: "3fv",
                            default_value: s.translation,
                        },
                        uInvalid: {
                            vtype: "1fv",
                            default_value: [s.invalid_coordinate],
                        },
                    },
                    inputs: {
                        aLL: {
                            per_vertex: false,
                            num_components: 1,
                            from_buffer: {
                                name: buffername,
                                skip_elements: 0,
                                element_stride: 1,
                            },
                        },
                        aLR: {
                            per_vertex: false,
                            num_components: 1,
                            from_buffer: {
                                name: buffername,
                                skip_elements: x_offset,
                            },
                        },
                        aUL: {
                            per_vertex: false,
                            num_components: 1,
                            from_buffer: {
                                name: buffername,
                                skip_elements: y_offset,
                            },
                        },
                        aUR: {
                            per_vertex: false,
                            num_components: 1,
                            from_buffer: {
                                name: buffername,
                                skip_elements: x_offset + y_offset,
                            },
                        },
                    }
                });
            };
            run() {
                // may not always need to do re-install uniforms?
                this.runner.install_uniforms();
                this.runner.run();
                var after_run_callback = this.settings.after_run_callback;
                if (after_run_callback) {
                    after_run_callback(this);
                }
            };
            linked_three_geometry (THREE) {
                // create a three.js geometry linked to the current positions feedback array.
                // xxxx only one geometry may be linked at a time.
                var positions = this.get_positions();
                var geometry = new THREE.BufferGeometry();
                geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
                var after_run = function(that) {
                    // update the geometry positions array in place and mark for update
                    geometry.attributes.position.array = that.get_positions(geometry.attributes.position.array);
                    geometry.attributes.position.needsUpdate = true;
                }
                this.settings.after_run_callback = after_run;
                return geometry;
            };
            set_threshhold(value) {
                //this.runner.uniforms.uValue.value = [value];
                this.runner.change_uniform("uValue", [value]);
                //this.runner.run();
            };
            get_positions(optionalPreAllocatedArrBuffer) {
                return this.runner.feedback_array(
                    "vPosition",
                    optionalPreAllocatedArrBuffer);
            };
        };
        var contour_vertex_shader = `#version 300 es
            // triangulate contour segments on pixel with vertex values aLL, aLR, aUL, aUR
            //
            // UL   V0   UR
            //  .---*---.
            //  | T0   /|
            //  |     / |
            //  * V1 /  |
            //  |   /   * V3
            //  |  /    |
            //  | /  T1 |
            //  .---*---.
            // LL   V2   LR
            //
            // output vertices are segment (V1, V0) crossing triangle T0, if exists
            //    and segment (V2, V3) crossing triangle T1 if exists.
            // The segments can be oriented opposite any of the 3 triangle vertices.

            // global length of rows
            uniform int uRowSize;

            // global number of columnss
            uniform int uColSize;
            
            // global contour threshhold
            uniform float uValue;

            // xxxxx add divisor for multiple contours...
            
            // uniform offsets in x,y,z directions, translation, line color
            uniform vec3 dx, dy, dz, translation, color;
            
            // invalid value marker
            uniform float uInvalid;
            
            // per mesh function values at pixel corners
            in float aLL, aLR, aUL, aUR;

            // per vertex -- which vertex? 0,1 on first triangle or 2,3 on second
            //in float aVertexCount;  not needed?

            // feedbacks out
            out vec3 vColor, vPosition;

            // debugging
            out float[4] vdump;

            //const int iLL = 0; (unused?)
            //const int iLR = 1;
            //const int iUL = 2;
            //const int iUR = 3;

            // square corner offsets
            const vec2 offsets[4] = vec2[](
                vec2(0.0,0.0),
                vec2(1.0,0.0),
                vec2(0.0,1.0),
                vec2(1.0,1.0)
            );

            // crossing index to segment endpoint indices
            //                            000 001 010 011 100 101 110 111
            const int Seg1Left[8] = int[]( -1,  1,  0,  2,  2,  0,  1, -1);
            const int Seg1Right[8]= int[]( -1,  2,  1,  0,  0,  1,  2, -1);
            const int Seg2Left[8] = int[]( -1,  2,  1,  0,  0,  1,  2, -1);
            const int Seg2Right[8]= int[]( -1,  0,  2,  1,  1,  2,  0, -1);

            void main() {
                // initially set output point to invalid
                gl_Position = vec4(uInvalid, uInvalid, uInvalid, uInvalid);
                vPosition = gl_Position.xyz;
                vColor = vec3(0.0, 0.0, 0.0);

                // size of layer of rows and columns in 3d grid
                int layer_size = uRowSize * uColSize;
                // instance depth of this layer
                int i_depth_num = gl_InstanceID / layer_size;
                // ravelled index in layer
                int i_layer_index = gl_InstanceID - (i_depth_num * layer_size);

                int i_row_num = i_layer_index/ uRowSize;
                int i_col_num = i_layer_index - (i_row_num * uRowSize);
                // Dont tile last column which wraps around rows
                //vdump = float[](float(uRowSize), col_num, row_num, float(gl_InstanceID));
                if ((i_col_num < (uRowSize - 1)) && (i_row_num < (uColSize - 1))) {
                    float row_num = float(i_row_num);
                    float col_num = float(i_col_num);
                    float depth_num = float(i_depth_num);
                    vdump = float[](aLL, aLR, aUL, aUR);
                    // determine which vertex in which triangle to interpolate
                    int iVertexCount = gl_VertexID;
                    int iTriangleNumber = iVertexCount / 2;
                    int iVertexNumber = iVertexCount - (iTriangleNumber * 2);
                    int iT1 = iTriangleNumber + 1;
                    vec2 triangle_offsets[3] = vec2[](
                        offsets[0],
                        offsets[iT1],
                        offsets[3]
                    );
                    float wts[4] = float[](aLL, aLR, aUL, aUR);
                    float triangle_wts[3] = float[](
                        wts[0],
                        wts[iT1],
                        wts[3]
                    );
                    //vdump = wts;
                    // crossing index
                    int ci = 0;
                    for (int i=0; i<3; i++) {
                        ci = ci << 1;
                        if (triangle_wts[i] > uValue) {
                            ci += 1;
                        }
                    }
                    //vColor = vec3(float(ci) * 0.1, float(iTriangleNumber), float(iVertexCount));
                    if (Seg1Left[ci] >= 0) {
                        int SegLs[2] = int[](Seg1Left[ci], Seg2Left[ci]);
                        int SegRs[2] = int[](Seg1Right[ci], Seg2Right[ci]);
                        int SegL = SegLs[iVertexNumber];
                        int SegR = SegRs[iVertexNumber];
                        vec2 offsetL = triangle_offsets[SegL];
                        vec2 offsetR = triangle_offsets[SegR];
                        float wtL = triangle_wts[SegL];
                        float wtR = triangle_wts[SegR];
                        // check denominator is not too small? xxxx
                        float delta = (wtL - uValue) / (wtL - wtR);
                        vec2 combined_offset = ((1.0 - delta) * offsetL) + (delta * offsetR);
                        //combined_offset = offsetL;
                        vec2 vertex = combined_offset + vec2(col_num, row_num);
                        vPosition = 
                            dx * vertex[0] + 
                            dy * vertex[1] + 
                            dz * depth_num + 
                            translation;
                        gl_Position.xyz = vPosition;
                        //vColor = abs(normalize(vec3(vertex)));  // XXX FOR TESTING ONLY
                        gl_Position[3] = 1.0;
                    }
                }
                vPosition = gl_Position.xyz;
            }
            `;
        
        var contour_fragment_shader = `#version 300 es
            #ifdef GL_ES
                precision highp float;
            #endif
            in vec3 vColor;
            out vec4 color;
    
            void main() {
                color = vec4(vColor, 1.0);
            }
            `;
        
        return new WebGL2Contour2d(options);
    };

    $.fn.webGL2contours2d.simple_example = function (container) {
        var gl = $.fn.feedWebGL2.setup_gl_for_example(container);

        var context = container.feedWebGL2({
            gl: gl,
        });
        var valuesArray = new Float32Array([
            1,0,0,
            0,1,0,
            0,0,0,

            0,0,0,
            0,1,0,
            0,0,0,

            0,0,0,
            0,1,0,
            1,0,0,
        ]);
        var h = 0.5
        var ddz = 0.1
        var contours = container.webGL2contours2d(
            {
                feedbackContext: context,
                valuesArray: valuesArray,
                num_rows: 3,
                num_cols: 3,
                num_layers: 3,
                dx: [h, 0, 0],
                dy: [0, h, 0],
                dz: [ddz, 0.33*ddz, h],
                translation: [-h, -h, -h],
                color: [h, h, h],
                rasterize: true,
                threshold: 0.3,
            }
        );
        // attach an input to change the threshold
        $("<br/>").appendTo(container);
        $("<span>Threshold: </span>").appendTo(container);
        var input = $('<input value="0.3" type="text"></p> ').appendTo(container);
        var dump = $("<div>data dump here</div>").appendTo(container);
        var update = (function () {
            var threshold = + input.val();
            gl.clearColor(0.8, 0.9, 1.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            contours.set_threshhold(threshold);
            contours.run();
            var tf = function(x) { return " " + x.toFixed(2)  + " "; };
            var positions = contours.get_positions();
            dump.empty();
            for (var i=0; i<positions.length; i+=4) {
                if (positions[i] > -100) {
                    $("<div>" + 
                    tf(positions[i])+ 
                    tf(positions[i+1])+ 
                    tf(positions[i+2])+ 
                    tf(positions[i+3])+ "</div>").appendTo(dump);
                }
            }
        });
        input.change(update);
        update();
        return contours;
    };

})(jQuery);