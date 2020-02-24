
/*

JQuery plugin populating 2 and 3 dimensional contours.

Requires nd_frame to be loaded.

Structure follows: https://learn.jquery.com/plugins/basic-plugin-creation/

*/
"use strict";

(function($) {

    $.fn.webGL2surfaces3d = function (options) {
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
                    //rasterize: false,
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
                    vertex_shader: tetrahedra_vertex_shader,
                    fragment_shader: tetrahedra_fragment_shader,
                    feedbacks: {
                        vPosition: {num_components: 3},
                        vNormal: {num_components: 3},
                        vColor: {num_components: 3},
                    },
                })

                var x_offset = 1;
                var y_offset = s.num_cols;
                var z_offset = s.num_cols * s.num_rows;
                var num_instances = nvalues - (x_offset + y_offset + z_offset);

                var inputs = {};
                var add_input = function (ix, iy, iz) {
                    var name = (("a" + ix) + iy) + iz;
                    var dx = [0, x_offset][ix];
                    var dy = [0, y_offset][iy];
                    var dz = [0, z_offset][iz];
                    inputs[name] = {
                        per_vertex: false,
                        num_components: 1,
                        from_buffer: {
                            name: buffername,
                            skip_elements: dx + dy + dz,
                        }
                    }
                };
                add_input(0,0,0);
                add_input(0,0,1);
                add_input(0,1,0);
                add_input(0,1,1);
                add_input(1,0,0);
                add_input(1,0,1);
                add_input(1,1,0);
                add_input(1,1,1);

                const N_TETRAHEDRA = 6;
                const N_TRIANGLES = 2;  
                const N_VERTICES = 3;
                var vertices_per_instance = N_TETRAHEDRA * N_TRIANGLES * N_VERTICES;
                // add vertex count bogus input for Firefox
                var vertexNumArray = new Float32Array(Array.from(Array(vertices_per_instance).keys()));
                this.vertex_num_buffer = this.feedbackContext.buffer()
                this.vertex_num_buffer.initialize_from_array(vertexNumArray);
                inputs["aVertexCount"] = {
                    per_vertex: true,
                    num_components: 1,
                    from_buffer: {
                        name: this.vertex_num_buffer.name,
                    }
                }

                this.runner = this.program.runner({
                    run_type: "TRIANGLES",
                    num_instances: num_instances,
                    vertices_per_instance: vertices_per_instance,
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
                    inputs: inputs,
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
                // this is a bit convoluted in an attempt to only update attributes when needed.
                var that = this;
                var positions = this.get_positions();
                var normals = this.get_normals();
                var colors = this.get_colors();
                var geometry = new THREE.BufferGeometry();
                geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
                geometry.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );
                geometry.setAttribute( 'color', new THREE.BufferAttribute( colors, 3 ) );
                that.link_needs_update = false;
                var after_run = function(that) {
                    debugger;
                    that.link_needs_update = true;
                }
                var check_update_link = function() {
                    // update the geometry positions array in place and mark for update in geometry
                    if (! that.link_needs_update) {
                        // only update upon request and only if needed
                        that.link_needs_update = false;
                        return;
                    }
                    geometry.attributes.position.array = that.get_positions(geometry.attributes.position.array);
                    geometry.attributes.position.needsUpdate = true;
                    geometry.attributes.normal.array = that.get_normals(geometry.attributes.normal.array);
                    geometry.attributes.normal.needsUpdate = true;
                    geometry.attributes.color.array = that.get_colors(geometry.attributes.color.array);
                    geometry.attributes.normal.needsUpdate = true;
                    that.link_needs_update = false;
                }
                this.settings.after_run_callback = after_run;
                this.check_update_link = check_update_link;
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
            get_normals(optionalPreAllocatedArrBuffer) {
                return this.runner.feedback_array(
                    "vNormal",
                    optionalPreAllocatedArrBuffer);
            };
            get_colors(optionalPreAllocatedArrBuffer) {
                return this.runner.feedback_array(
                    "vColor",
                    optionalPreAllocatedArrBuffer);
            };
        };
        var tetrahedra_vertex_shader = `#version 300 es
        // triangulate tetrahedral tiling on voxel with vertex values 
        //  a000 .. a111
        // Each voxel is divided into 6 tetrahedra with
        // each tetrahedron split by (up to) 2 triangles.

        // global length of rows, cols
        uniform int uRowSize;
        uniform int uColSize;
        
        // global contour threshhold
        uniform float uValue;
        
        // uniform offsets in xyz directions
        uniform vec3 dx, dy, dz, translation;
        
        // invalid value marker
        uniform float uInvalid;
        
        // per mesh function values at voxel corners
        in float a000, a001, a010, a011, a100, a101, a110, a111;

        // Which vertex in which triangle on which tetrahedron?
        //   encodes tetrahedron_number 0..4, triangle_number 0..1, vertex number 0..2
        //   for a total of 5 * 2 * 3 = 30 vertices per "mesh instance".
        //   aVertexCount = tetrahedron_number * 10 + triangle_number * 3 + vertex_number;
        const int N_TETRAHEDRA = 6; // tetrahedra per cube
        const int N_TRIANGLES = 2;  // triangles per tetrahedron
        const int N_VERTICES = 3;   // vertices per triangle
        const int N_CORNERS = 8;    // number of cube corners
        const int N_T_VERTICES = 4; // number of vertices in a tetrahedron

        // bogus vertex attribute required by Firefox (but not Chrome)
        in float aVertexCount;

        // Crossing index is binary integer of form
        //   (triangle_num << 4) || ((fA > v) << 3 || ((fA > v) << 2 || ((fA > v) << 1 || ((fA > v)
        const int N_CROSSING_INDEX = 32;  // 2 ** 5

        // corner offsets
        const vec3 offsets[N_CORNERS] = vec3[] (
            vec3(0.0, 0.0, 0.0),
            vec3(0.0, 0.0, 1.0),
            vec3(0.0, 1.0, 0.0),
            vec3(0.0, 1.0, 1.0),
            vec3(1.0, 0.0, 0.0),
            vec3(1.0, 0.0, 1.0),
            vec3(1.0, 1.0, 0.0),
            vec3(1.0, 1.0, 1.0)
        );

        // vertex indices for tiling tetrahedra per tetrahedron number
        const int A_INDEX = 0;
        const int[N_TETRAHEDRA] B_index = int[] (4, 6, 2, 3, 1, 5) ;
        const int[N_TETRAHEDRA] C_index = int[] (6, 2, 3, 1, 5, 4) ;
        const int D_INDEX = 7;

        // crossing index to triangle vertices endpoint indices
        const int U_left[N_CROSSING_INDEX] = int[] (
            -1, 3, 2, 0, 1, 0, 0, 0, 0, 1, 1, 1, 2, 2, 3,-1,
            -1,-1,-1, 0,-1, 0, 0,-1,-1, 1, 1,-1, 2,-1,-1,-1);
        const int U_right[N_CROSSING_INDEX] = int[] (
            -1, 1, 1, 2, 2, 1, 1, 2, 2, 0, 0, 2, 0, 1, 1,-1,
            -1,-1,-1, 3,-1, 3, 2,-1,-1, 3, 2,-1, 1,-1,-1,-1);
        const int V_left[N_CROSSING_INDEX] = int[] (
            -1, 3, 2, 1, 1, 0, 3, 0, 0, 2, 1, 1, 3, 2, 3,-1,
            -1,-1,-1, 1,-1, 2, 3,-1,-1, 2, 3,-1, 3,-1,-1,-1);
        const int V_right[N_CROSSING_INDEX] = int[] (
            -1, 0, 3, 2, 0, 3, 1, 1, 3, 0, 2, 3, 0, 0, 2,-1,
            -1,-1,-1, 2,-1, 3, 1,-1,-1, 0, 2,-1, 0,-1,-1,-1);
        const int W_left[N_CROSSING_INDEX] = int[] (
            -1, 3, 2, 0, 1, 2, 0, 0, 0, 1, 3, 1, 2, 2, 3,-1,
            -1,-1,-1, 1,-1, 2, 3,-1,-1, 2, 3,-1, 3,-1,-1,-1);
        const int W_right[N_CROSSING_INDEX] = int[] (
            -1, 2, 0, 3, 3, 1, 2, 3, 1, 3, 0, 0, 1, 3, 0,-1,
            -1,-1,-1, 3,-1, 1, 2,-1,-1, 3, 0,-1, 1,-1,-1,-1);

        // feedbacks out
        out vec3 vColor, vPosition, vNormal;

        // debugging
        out float[4] vdump;

        void main() {
            // initially set output point to invalid
            gl_Position = vec4(uInvalid, uInvalid, uInvalid, uInvalid);
            // use the bogus vertexCount parameter so it is not erased by the optimizer
            float grey = aVertexCount / float(N_TETRAHEDRA * N_TRIANGLES * N_VERTICES);
            vColor = vec3(float(gl_VertexID) * 0.01, grey, 0.0);  // temp value for debugging
            vNormal = vec3(0.0, 0.0, 1.0);    // arbitrary initial value

            // size of layer of rows and columns in 3d grid
            int layer_size = uRowSize * uColSize;
            // instance depth of this layer
            int i_depth_num = gl_InstanceID / layer_size;
            // ravelled index in layer
            int i_layer_index = gl_InstanceID - (i_depth_num * layer_size);
            // instance row
            int i_row_num = i_layer_index / uRowSize;
            // instance column
            int i_col_num = i_layer_index - (i_row_num * uRowSize);
            // float versions for calculations
            float layer_num = float(i_depth_num);
            float row_num = float(i_row_num);
            float col_num = float(i_col_num);

            // Dont tile last column which wraps around or last row
            if (i_col_num < (uRowSize - 1) && (i_row_num < (uColSize - 1))) {
                // determine which vertex in which triangle in which tetrahedron to interpolate
                int iVertexCount = gl_VertexID;
                int iTetrahedronNumber = iVertexCount / (N_TRIANGLES * N_VERTICES);
                int iTetIndex = iVertexCount - (N_TRIANGLES * N_VERTICES) * iTetrahedronNumber;
                int iTriangleNumber = iTetIndex / N_VERTICES;
                int iVertexNumber = iTetIndex - (iTriangleNumber * N_VERTICES);
                // offsets of vertices for this tet number
                vec3 t_offsets[N_T_VERTICES] = vec3[](
                    offsets[A_INDEX],
                    offsets[B_index[iTetrahedronNumber]],
                    offsets[C_index[iTetrahedronNumber]],
                    offsets[D_INDEX]
                );
                // weights as array
                float wts[N_CORNERS] = float[](
                    a000, a001, a010, a011, a100, a101, a110, a111);
                // weights of vertices for this tet number
                float t_wts[N_T_VERTICES] = float[](
                    wts[A_INDEX],
                    wts[B_index[iTetrahedronNumber]],
                    wts[C_index[iTetrahedronNumber]],
                    wts[D_INDEX]
                );
                vdump = t_wts;

                // crossing index
                int ci = iTriangleNumber << 1;
                if (t_wts[0] > uValue) { ci = ci + 1; }
                ci = ci << 1;
                if (t_wts[1] > uValue) { ci = ci + 1; }
                ci = ci << 1;
                if (t_wts[2] > uValue) { ci = ci + 1; }
                ci = ci << 1;
                if (t_wts[3] > uValue) { ci = ci + 1; }

                // If U_left[ci] for this corner is negative (invalid index) then there is no such triangle here.
                if (U_left[ci] >= 0) {
                    int SegLs[N_VERTICES] = int[](U_left[ci], V_left[ci], W_left[ci]);
                    int SegRs[N_VERTICES] = int[](U_right[ci], V_right[ci], W_right[ci]);
                    
                    int SegL = SegLs[iVertexNumber];
                    int SegR = SegRs[iVertexNumber];
                    vec3 offsetL = t_offsets[SegL];
                    vec3 offsetR = t_offsets[SegR];
                    
                    float wtL = t_wts[SegL];
                    float wtR = t_wts[SegR];
                    // check denominator is not too small? xxxx
                    float delta = (wtL - uValue) / (wtL - wtR);
                    vec3 combined_offset = ((1.0 - delta) * offsetL) + (delta * offsetR);
                    vec3 vertex = combined_offset + vec3(col_num, row_num, layer_num);
                    vPosition = dx * vertex[0] + dy * vertex[1] + dz * vertex[2] + translation;
                    gl_Position.xyz = vPosition;
                    gl_Position[3] = 1.0;
                    vdump = float[4](vertex[0], vertex[1], vertex[2], delta);

                    // Compute normal for the whole tetrahedron
                    vec3 center = (t_offsets[0] + t_offsets[1] + t_offsets[2] + t_offsets[3])/4.0;
                    vec3 nm = ( 
                        + (t_offsets[0] - center) * (t_wts[0] - uValue) 
                        + (t_offsets[1] - center) * (t_wts[1] - uValue) 
                        + (t_offsets[2] - center) * (t_wts[2] - uValue) 
                        + (t_offsets[3] - center) * (t_wts[3] - uValue) 
                        );
                    float ln = length(nm);
                    if (ln > 1e-12) {
                        vNormal = nm / ln;
                    }
                    vColor = abs(vNormal);  // XXX FOR TESTING ONLY
                }
            }
            vPosition = gl_Position.xyz;
        }
        `;
        
        var tetrahedra_fragment_shader = `#version 300 es
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

    $.fn.webGL2surfaces3d.simple_example = function (container) {
        var gl = $.fn.feedWebGL2.setup_gl_for_example(container);

        var context = container.feedWebGL2({
            gl: gl,
        });
        var valuesArray = new Float32Array([
            0,0,0,
            0,0,0,
            0,0,0,

            0,0,0,
            0,1,0,
            0,0,0,

            0,0,0,
            0,-1,0,
            0,0,0,
        ]);
        var h = 0.5
        var ddz = 0.1
        var contours = container.webGL2surfaces3d(
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
            $("<div>" + positions.length + " POSITIONS </div>").appendTo(dump);
            for (var i=0; i<positions.length; i+=3) {
                if (true || positions[i] > -100) {
                    $("<div>" + 
                    tf(positions[i])+ 
                    tf(positions[i+1])+ 
                    tf(positions[i+2])+ 
                    "</div>").appendTo(dump);
                }
            }
            var normals = contours.get_normals();
            $("<br/>").appendTo(dump);
            $("<div>" + normals.length + " NORMALS </div>").appendTo(dump);
            for (var i=0; i<normals.length; i+=3) {
                if (true || normals[i] > -100) {
                    $("<div>" + 
                    tf(normals[i])+ 
                    tf(normals[i+1])+ 
                    tf(normals[i+2])+ 
                    "</div>").appendTo(dump);
                }
            }
        });
        input.change(update);
        update();
        return contours;
    };

})(jQuery);