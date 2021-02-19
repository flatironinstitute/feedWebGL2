
/*

JQuery plugin populating 2 and 3 dimensional contours.

Requires nd_frame to be loaded.

Structure follows: https://learn.jquery.com/plugins/basic-plugin-creation/

*/
"use strict";

(function($) {


    var noop_fragment_shader = `#version 300 es
    #ifdef GL_ES
        precision highp float;
    #endif
    
    out vec4 color;

    void main() {
        color = vec4(1.0, 0.0, 0.0, 1.0);
    }
    `;

    var std_sizes_declarations = `
    int voxel_index;
    int i_block_num;
    int i_depth_num;
    int i_row_num;
    int i_col_num;
    float f_col_num;
    float f_row_num;
    float f_depth_num;
    vec3 location_offset;
    `;

    var get_sizes_macro = function(index_variable_name) {
        return `
        voxel_index = ${index_variable_name};
        
        // size of layer of rows and columns in 3d grid block
        int layer_voxels = uRowSize * uColSize;
        //int i_block_num;
        int block_index;

        if (uLayerSize > 1) {
            // possibly multiple grids in blocks.
            // size of block of rows/columns/layers
            int block_voxels = layer_voxels * uLayerSize;

            // block number for this voxel
            i_block_num = voxel_index / block_voxels;
            // ravelled index in block
            block_index = voxel_index - (i_block_num * block_voxels);
        } else {
            // only one block
            i_block_num = 0;
            block_index = voxel_index;
        }

        // instance depth of this layer
        i_depth_num = block_index / layer_voxels;
        // ravelled index in layer
        int i_layer_index = block_index - (i_depth_num * layer_voxels);

        i_row_num = i_layer_index/ uRowSize;
        i_col_num = i_layer_index - (i_row_num * uRowSize);

        f_col_num = float(i_col_num);
        f_row_num = float(i_row_num);
        f_depth_num = float(i_depth_num);
        //float f_block_num = float(i_block_num);  // not needed?
        location_offset = vec3(f_depth_num, f_row_num, f_col_num);
        `;
    };

    // functions to compute (x,y,z) location of offset relative to voxel location.
    var grid_location_decl = `
    vec3 grid_location(in vec3 offset) {
        vec3 rescaled = rescale_offset(offset);
        return grid_xyz(rescaled);
    }
    `;

    var locate_std_decl = `
    vec3 rescale_offset(in vec3 offset) {
        // convert voxel offset to block grid
        return location_offset + offset;
    }

    vec3 grid_xyz(in vec3 offset) {
        // convert block grid coords to xyz (trivial here)
        return offset;
    }
    ${grid_location_decl}
    `;

    // xxxx the scaling and and polar conversion could be separated eventually if useful.
    var locate_polar_scaled_decl = `

    // all samplers hold value in R component only.
    // [block, row] --> row_scaled
    uniform sampler2D RowScale;

    // [block, col] --> col_scaled
    uniform sampler2D ColumnScale;

    // [block, layer] --> layer_scaled
    uniform sampler2D LayerScale;

    float rescale_f(in float offset, in int index, in sampler2D scaling) {
        // note: indices are inverted from matrix notation matrix[y,x] === sampler(x,y) (???)
        //float x0 = texelFetch(scaling, ivec2(i_block_num, index), 0).r;
        //float x1 = texelFetch(scaling, ivec2(i_block_num, index+1), 0).r;
        float x0 = texelFetch(scaling, ivec2(index, i_block_num), 0).r;
        float x1 = texelFetch(scaling, ivec2(index+1, i_block_num), 0).r;
        return (x0 * (1.0 - offset)) + (x1 * offset);  // no clamping?
    }

    vec3 rescale_offset(in vec3 offset) {
        // convert voxel offset to block grid.
        // spherical coordinates using the "3rd major convention"
        // https://en.wikipedia.org/wiki/Spherical_coordinate_system#Conventions
        float r = rescale_f(offset[0], i_depth_num, LayerScale);
        // swapping phi and theta.
        float phi = rescale_f(offset[1], i_row_num, RowScale);
        float theta = rescale_f(offset[2], i_col_num, ColumnScale);
        return vec3(r, phi, theta);
    }

    vec3 grid_xyz(in vec3 spherical) {
        // convert block polar grid coords to xyz (non-trivial)
        float r = spherical[0];
        // swapping phi and theta.
        float phi = spherical[1];
        float theta = spherical[2];
        //return vec3(r, theta, phi);
        
        float sint = sin(theta);
        float cost = cos(theta);
        float sinp = sin(phi);
        float cosp = cos(phi);
        float x = r * sinp * cost;
        float y = r * sinp * sint;
        float z = r * cosp;
        return vec3(x, y, z);
    }
    ${grid_location_decl}
    `;

    $.fn.webGL2voxelSorter = function(options) {
        class WebGL2voxelSorter {
            constructor(options) {
                this.settings = $.extend({
                    valuesArray: null,   // the array buffer of values to contour
                    num_rows: null,
                    num_cols: null,
                    num_layers: 1,  // default to "flat"
                    num_blocks: 1,  // for physics simulations data may come in multiple blocks
                }, options);

                // generate stats in a temporary context.
                var feedbackContext = $.fn.feedWebGL2({});
                // generate stats...
                var s = this.settings;
                var nvalues = s.valuesArray.length;
                var nvoxels = s.num_rows * s.num_cols * s.num_layers * s.num_blocks;
                if (nvalues != nvoxels) {
                    // for now strict checking
                    throw new Error("voxels " + nvoxels + " don't match values " + nvalues);
                }
                // allocate and load buffer with a fresh name
                var buffer = feedbackContext.buffer()
                buffer.initialize_from_array(s.valuesArray);
                var buffername = buffer.name;

                var program = feedbackContext.program({
                    vertex_shader: voxelSorterShader,
                    feedbacks: {
                        index: {type: "int"},
                        front_corners: {num_components: 4},
                        back_corners: {num_components: 4},
                        //min_corner: {num_components: 1},
                        //max_corner: {num_components: 1},
                        corner_extrema: {num_components: 2},
                    },
                });
                var inputs = {};
                var num_voxels = add_corner_offset_inputs(s, nvalues, buffername, inputs);

                var runner = program.runner({
                    num_instances: 1,
                    vertices_per_instance: num_voxels,
                    uniforms: {
                        // number of rows
                        uRowSize: {
                            vtype: "1iv",
                            default_value: [s.num_cols],
                        },
                        // numver of columns
                        uColSize: {
                            vtype: "1iv",
                            default_value: [s.num_rows],
                        },
                        // number of layers
                        uLayerSize: {
                            vtype: "1iv",
                            default_value: [s.num_layers],
                        },
                    },
                    inputs: inputs,
                });
                runner.run();
                // get all feedbacks from GPU into Javascript context
                var indices0 = runner.feedback_array("index");
                var front_corners0 = runner.feedback_array("front_corners");
                var back_corners0 = runner.feedback_array("back_corners");
                //var min_corners0 = runner.feedback_array("min_corner");
                //var max_corners0 = runner.feedback_array("max_corner");
                var extrema = runner.feedback_array("corner_extrema");
                // unpack extrema for convenience
                var min_corners0 = new Float32Array(num_voxels);
                var max_corners0 = new Float32Array(num_voxels);
                var extrema_index = 0;
                for (var i=0; i<num_voxels; i++) {
                    min_corners0[i] = extrema[extrema_index];
                    extrema_index ++;
                    max_corners0[i] = extrema[extrema_index];
                    extrema_index ++;
                }

                // compactiffy to remove invalid entries
                var indices = feedbackContext.filter_degenerate_entries(indices0, indices0, null, 1, -1, true);
                var front_corners = feedbackContext.filter_degenerate_entries(indices0, front_corners0, null, 4, -1, true);
                var back_corners = feedbackContext.filter_degenerate_entries(indices0, back_corners0, null, 4, -1, true);
                var min_corners = feedbackContext.filter_degenerate_entries(indices0, min_corners0, null, 1, -1, true);
                var max_corners = feedbackContext.filter_degenerate_entries(indices0, max_corners0, null, 1, -1, true);

                // sort indices by max_corner
                var sorter_len = max_corners.length;
                var max_corner_indices = new Uint32Array(sorter_len);
                for (var i=0; i<sorter_len; i++) {
                    max_corner_indices[i] = i;
                }
                var compare = function (i, j) {
                    return max_corners[i] - max_corners[j];
                }
                max_corner_indices.sort(compare);

                // make all feedbacks conform to index order
                var conform = function (buffer, num_components) {
                    var len = buffer.length;
                    var to_buffer = new (buffer.constructor)(len);
                    var buffer_index = 0;
                    for (var sort_index=0; sort_index<sorter_len; sort_index++) {
                        var copy_index = max_corner_indices[sort_index] * num_components;
                        for (var i=0; i<num_components; i++) {
                            to_buffer[buffer_index] = buffer[copy_index];
                            copy_index ++;
                            buffer_index ++;
                        }
                    }
                    return to_buffer;
                };
                this.indices = conform(indices, 1);
                this.front_corners = conform(front_corners, 4);
                this.back_corners = conform(back_corners, 4);
                this.min_corners = conform(min_corners, 1);
                this.max_corners = conform(max_corners, 1);
                // sanity check: max_corners should be sorted
                max_corners = this.max_corners;
                for (var i=0; i<sorter_len-1; i++) {
                    if (max_corners[i] > max_corners[i+1]) {
                        throw new Error("Max corner conformation failed: " + [i, max_corners[i], max_corners[i+1]]);
                    }
                }

                // dispose of temporary context (all generated data is in Javascript space, free up GPU)
                feedbackContext.lose_context();
                feedbackContext = program = runner = null;
            };

            threshold_start_index(threshold) {
                // determine the least index in max_corners of the where max_corners[index] >= threshold
                // (binary search)
                var max_corners = this.max_corners;
                var low_index = 0;
                var high_index = max_corners.length;
                while ((low_index + 1) < high_index) {
                    var test_index = Math.floor(0.5 * (low_index + high_index));
                    if (max_corners[test_index] < threshold) {
                        low_index = test_index;
                    } else {
                        high_index = test_index;
                    }
                }
                return high_index;
            };
        };

        return new WebGL2voxelSorter(options);
    };

    var voxelSorterShader = `#version 300 es
    // global length of rows
    uniform int uRowSize;

    // global number of columnss
    uniform int uColSize;

    // global number of layers (if values are in multiple blocks, else 0)
    uniform int uLayerSize;

    // per mesh function values at voxel corners
    in float a000, a001, a010, a011, a100, a101, a110, a111;

    // corners feedbacks
    out vec4 front_corners, back_corners;

    // min/max corner feedback
    out vec2 corner_extrema;  // [min, max] of corner values.

    // index feedback
    flat out int index;

    ${std_sizes_declarations}

    void main() {
        // default to invalid index indicating the voxel is not in the interior.
        index = -1;
        front_corners = vec4(a000, a001, a010, a011);
        back_corners = vec4(a100, a101, a110, a111);
        //min_corner = 0.0;
        //max_corner = 0.0;
        corner_extrema = vec2(0.0, 0.0);
        ${get_sizes_macro("gl_VertexID")}
        // Dont tile last column/row/layer which wraps around
        bool voxel_ok = (
            (i_col_num < (uRowSize - 1)) && 
            (i_row_num < (uColSize - 1)) &&
            (i_depth_num < (uLayerSize - 1))
        );
        if (voxel_ok) {
            // the voxel is interior
            index = gl_VertexID;
            float m = front_corners[0];
            float M = front_corners[0];
            vec4 corners = front_corners;
            for (int j=0; j<2; j++) {
                for (int i=0; i<4; i++) {
                    float c = corners[i];
                    m = min(c, m);
                    M = max(c, M);
                }
                corners = back_corners;
            }
            //min_corner = m;
            //max_corner = M;
            corner_extrema = vec2(m, M);
        }
    }
    `;

    var get_indexer = function (num_cols, num_rows, num_layers) {
        var y_offset = num_cols;
        var x_offset = y_offset * num_rows;
        var block_offset = x_offset * num_layers;
        var indexer = function(xyzblock) {
            var [x_index, y_index, z_index, block_index] = xyzblock
            var index = x_index * x_offset + y_index * y_offset + z_index + block_offset * block_index;
            return index;
        };
        return indexer;
    };

    var get_deindexer = function (num_cols, num_rows, num_layers) {
        var y_offset = num_cols;
        var x_offset = y_offset * num_rows;
        var block_offset = x_offset * num_layers;
        var deindexer = function(index) {
            var block_index = 0;
            var block_rem = index;
            if (block_offset) {
                var block_index = Math.floor(index / block_offset);
                var block_rem = index % block_offset;
            }
            var x_index = Math.floor(block_rem / x_offset);
            var x_rem = block_rem % x_offset;
            var y_index = Math.floor(x_rem, y_offset);
            var z_index = x_rem % y_offset;
            var xyzblock = [x_index, y_index, z_index, block_index];
            return xyzblock;
        };
        return deindexer;
    };

    // expose indexer externally
    $.fn.webGL2voxelSorter.get_indexer = get_indexer;

    var select_connected_voxels = function(voxel_indices, seed_xyzblock, target) {
        // transitive closure on adjacent voxels
        var settings = target.settings;
        var index_tester = {};
        for (var i=0; i<voxel_indices.length; i++) {
            var index = voxel_indices[i];
            if (index >= 0) {
                index_tester[index] = true;
            }
        }
        var indexer = get_indexer(settings.num_cols, settings.num_rows, settings.num_layers);
        //var deindexer = get_deindexer(settings.num_cols, settings.num_rows, settings.num_layers);
        var seed_index = indexer(seed_xyzblock);
        var horizon = {}
        horizon[seed_index] = [seed_index, seed_xyzblock];
        var count = 1;
        var total = 0;
        var visited = {};
        while (count>0) {
            count = 0;
            var vcount = 0;
            var next_horizon = {};
            for (var key in horizon) {
                var [index, xyzblock] = horizon[key];
                // boundary case can be missing in crossing voxels
                if (index_tester[index]) {   
                    visited[index] = index;
                    vcount ++;
                }
                var [x_index, y_index, z_index, block_index] = xyzblock;
                var hi_x = x_index + 1;
                var hi_y = y_index + 1;
                var hi_z = z_index + 1;
                var lo_x = Math.max(0, x_index-1);
                var lo_y = Math.max(0, y_index-1);
                var lo_z = Math.max(0, z_index-1);
                // xxxx for now don't follow block! ????
                for (var ix=lo_x; ix<=hi_x; ix++) {
                    for (var iy=lo_y; iy<=hi_y; iy++) {
                        for (var iz=lo_z; iz<=hi_z; iz++) {
                            var test_xyzblock = [ix, iy, iz, block_index];
                            var test_index = indexer(test_xyzblock);
                            var test = index_tester[test_index];
                            // DEBUG
                            //if (vcount < 10) {
                            //    var yesno = test ? "YES " : "NO  ";
                            //    var value = settings.valuesArray[test_index];
                            //    console.log(yesno + [vcount, ix, iy, iz] + " : " + [test_index, value]);
                            //}
                            // END DEBUG
                            if ((test) || (test===0)) {
                                var v = visited[test_index];
                                var h = horizon[test_index];
                                if ((!h) && (!v) && (v!==0)) {
                                    next_horizon[test_index] = [test_index, test_xyzblock]
                                    count += 1;
                                }
                            }
                        }
                    }
                }
            }
            horizon = next_horizon;
            total += vcount;
            if (total > voxel_indices.length) {
                throw new Error("Iteration sanity check failed. Infinite loop? " + total);
            }
        }
        var result_indices = voxel_indices.slice();
        for (var i=0; i<voxel_indices.length; i++) {
            var index = voxel_indices[i];
            if ((index >= 0) && (visited[index])) {
                // connected.
                result_indices[i] = index;
            } else {
                // not connected
                result_indices[i] = -1;
            }
        }
        target.connected_voxel_count = total;
        return result_indices;
    };

    var add_corner_offset_inputs = function(s, nvalues, buffername, inputs) {
        // add input parameters for voxel corners as indexed into ravelled buffer.
        // return highest index of interior voxel.
        //  indexing is [ix, iy, iz] -- z is fastest
        //var x_offset = 1;
        var z_offset = 1;
        var y_offset = s.num_cols;
        //var z_offset = s.num_cols * s.num_rows;
        var x_offset = s.num_cols * s.num_rows;
        var num_voxels = nvalues - (x_offset + y_offset + z_offset);

        var add_input = function (ix, iy, iz) {
            var name = (("a" + ix) + iy) + iz;
            var dx = [0, x_offset][ix];
            var dy = [0, y_offset][iy];
            var dz = [0, z_offset][iz];
            inputs[name] = {
                per_vertex: true,
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
        return num_voxels;
    };

    $.fn.webGL2voxelSorter.example = function (container) {
        var gl = $.fn.feedWebGL2.setup_gl_for_example(container);

        var context = container.feedWebGL2({
            gl: gl,
        });
        var valuesArray = new Float32Array([
            2,1,0,
            1,1,0,
            0,0,0,

            1,1,0,
            1,1,0,
            0,0,0,

            0,0,0,
            0,0,0,
            0,0,0,
        ]);
        var sorter = container.webGL2voxelSorter({
            valuesArray: valuesArray,
            num_rows: 3,
            num_cols: 3,
            num_layers: 3,
        });
        var indices = sorter.indices;
        var front_corners = sorter.front_corners;
        var back_corners = sorter.back_corners;
        var minc = sorter.min_corners;
        var maxc = sorter.max_corners;
        var ci = 0;
        for (var i=0; i<indices.length; i++) {
            $("<br/>").appendTo(container);
            $("<span> " + indices[i] + " m" + minc[i] + " M" + maxc[i] + " </span>").appendTo(container);
            for (var j=0; j<4; j++) {
                $("<span> " + front_corners[ci] + " " + back_corners[ci] + " </span>").appendTo(container);
                ci ++;
            }
        }
    };

    $.fn.webGL2crossingVoxels = function(options) {
        return new WebGL2CrossingVoxels(options);
    };

    class WebGL2CrossingVoxels {
        constructor(options) {
            this.settings = $.extend({
                feedbackContext: null,    // the underlying FeedbackContext context to use
                valuesArray: null,   // the array buffer of values to contour
                num_rows: null,
                num_cols: null,
                num_layers: 1,  // default to "flat"
                num_blocks: 1,  // for physics simulations data may come in multiple blocks
                grid_min: [0, 0, 0],
                grid_max: [-1, -1, -1],  // disabled grid coordinate filtering (invalid limits)
                rasterize: false,
                threshold: 0,  // value at contour
                // when getting compact arrays
                // shrink the array sizes by this factor.
                shrink_factor: 0.2,
                // grid coordinate convention.
                location: "std",
                // samplers are prepared by caller if needed.  Descriptors provided by caller.
                samplers: {},
                // invalid marker
                location_fill: -1e12,
                // coordinate vectors
                dx: [1, 0, 0],
                dy: [0, 1, 0],
                dz: [0, 0, 1],
                fragment_shader: noop_fragment_shader,
            }, options);

            this.initialize();
        }

        initialize() {
            var s = this.settings;
            this.feedbackContext = s.feedbackContext;
            var nvalues = s.valuesArray.length;
            var nvoxels = s.num_rows * s.num_cols * s.num_layers * s.num_blocks;
            if (nvalues != nvoxels) {
                // for now strict checking
                throw new Error("voxels " + nvoxels + " don't match values " + nvalues);
            }
            // allocate and load buffer with a fresh name
            this.buffer = this.feedbackContext.buffer()
            this.buffer.initialize_from_array(s.valuesArray);
            var buffername = this.buffer.name;

            var vertex_shader;
            if (s.location == "std") {
                vertex_shader = crossingVoxelsShader(locate_std_decl);
            } else if (s.location="polar_scaled") {
                vertex_shader = crossingVoxelsShader(locate_polar_scaled_decl);
            } else {
                throw new Error("unknown grid location type: " + s.location);
            }

            this.program = this.feedbackContext.program({
                vertex_shader: vertex_shader,
                fragment_shader: this.settings.fragment_shader,
                feedbacks: {
                    index: {type: "int"},
                    location: {num_components: 3},
                    front_corners: {num_components: 4},
                    back_corners: {num_components: 4},
                },
            });

            var inputs = {};
            var num_voxels = add_corner_offset_inputs(s, nvalues, buffername, inputs);

            this.runner = this.program.runner({
                num_instances: 1,
                vertices_per_instance: num_voxels,
                rasterize: s.rasterize,
                uniforms: {
                    // number of rows
                    uRowSize: {
                        vtype: "1iv",
                        default_value: [s.num_cols],
                    },
                    // numver of columns
                    uColSize: {
                        vtype: "1iv",
                        default_value: [s.num_rows],
                    },
                    // number of layers
                    uLayerSize: {
                        vtype: "1iv",
                        default_value: [s.num_layers],
                    },
                    // threshold value
                    uValue: {
                        vtype: "1fv",
                        default_value: [s.threshold],
                    },
                    u_grid_min: {
                        vtype: "3fv",
                        default_value: s.grid_min,
                    },
                    u_grid_max: {
                        vtype: "3fv",
                        default_value: s.grid_max,
                    },
                },
                inputs: inputs,
                samplers: s.samplers,
            });
            this.front_corners_array = null;
            this.back_corners_array = null;
            this.index_array = null;
            this.compact_length = null;
        };
        run() {
            this.runner.install_uniforms();
            this.runner.run();
        };
        get_sphere_mesh(options) {
            // must be run after get_compacted_feedbacks has run at least once.
            var settings = $.extend({
                THREE: null,   // required THREE instance
                material: null, // material to use
                radius: 1,  // shared radius for spheres
                width_segments: 10,
                height_segments: 10,}, options);
            settings.locations = this.compact_locations;
            return $.fn.webGL2crossingVoxels.spheresMesh(settings);
        };
        get_points_mesh(options) {
            // must be run after get_compacted_feedbacks has run at least once.
            var that = this;
            var settings = $.extend({
                THREE: null,   // required THREE instance
                size: null,
                colorize: false,
            }, options);
            settings.locations = this.compact_locations;
            settings.center = this.compacted_feedbacks.mid;
            settings.radius = this.compacted_feedbacks.radius;
            if (settings.colorize) {
                settings.colors = this.get_location_colors();
            }
            var result = $.fn.webGL2crossingVoxels.pointsMesh(settings);
            result.update_sphere_locations = function(locations, colors) {
                locations = locations || that.compact_locations;
                var geometry = result.geometry;
                geometry.attributes.position.array = locations;
                geometry.attributes.position.needsUpdate = true;
                if (settings.colorize) {
                    colors = colors || that.get_location_colors();
                    geometry.attributes.color.array = colors;
                    geometry.attributes.color.needsUpdate = true;
                }
                var c = that.compacted_feedbacks.mid;
                var r = that.compacted_feedbacks.radius;
                geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(c[0], c[1], c[2]), r);
            };
            result.update_sphere_locations();
            return result;
        };
        get_feedbacks(location_only) {
            this.run();
            var rn = this.runner;
            if (!location_only) {
                this.front_corners_array = rn.feedback_array(
                    "front_corners",
                    this.front_corners_array,
                );
                this.back_corners_array = rn.feedback_array(
                    "back_corners",
                    this.back_corners_array,
                );
                // xxxx locations are not always needed -- could optimize.
                this.location_array = rn.feedback_array(
                    "location",
                    this.location_array,
                );
            } else {
                this.location_array = rn.feedback_array(
                    "location",
                    this.location_array,
                );
            }
            this.index_array = rn.feedback_array(
                "index",
                this.index_array,
            );
        };
        full_index_indicator_array() {
            // make a fresh copy of indicator_array[index]==index only if index is crossing
            // otherwise indicator_array[i] < 0 indicates not crossing.
            return this.index_array.slice(0);  // for this implementation, just copy...
        };
        set_seed(xyz_block) {
            this.settings.seed_xyzblock = xyz_block;
        };
        get_compacted_feedbacks(location_only) {
            this.get_feedbacks(location_only);
            var s = this.settings;
            var location_fill = this.settings.location_fill;
            if (this.compact_length === null) {
                // allocate arrays to size limit
                this.compact_length = Math.floor(
                    this.settings.shrink_factor * this.index_array.length
                );
                this.compact_front_corners = new Float32Array(4 * this.compact_length);
                this.compact_back_corners = new Float32Array(4 * this.compact_length);
                this.compact_indices = new Int32Array(this.compact_length);
                this.compact_locations = new Float32Array(3 * this.compact_length);
            }
            // if the seed is defined, trace connected voxels
            this.connected_voxel_count = null;
            if (s.seed_xyzblock) {
                this.index_array = select_connected_voxels(this.index_array, s.seed_xyzblock, this);
            }
            // compact the arrays
            this.compact_indices = this.feedbackContext.filter_degenerate_entries(
                this.index_array, this.index_array, this.compact_indices, 1, -1
            );
            if (!location_only) {
                this.compact_front_corners = this.feedbackContext.filter_degenerate_entries(
                    this.index_array, this.front_corners_array, this.compact_front_corners, 4, -1
                );
                this.compact_back_corners = this.feedbackContext.filter_degenerate_entries(
                    this.index_array, this.back_corners_array, this.compact_back_corners, 4, -1
                );
                // xxxx locations are not always needed -- could optimize.
                this.compact_locations = this.feedbackContext.filter_degenerate_entries(
                    this.index_array, this.location_array, this.compact_locations, 3, location_fill
                );
            } else {
                this.compact_locations = this.feedbackContext.filter_degenerate_entries(
                    this.index_array, this.location_array, this.compact_locations, 3, location_fill
                );
            }
            // compute compact locations and extrema
            var mins = null;
            var maxes = null;
            var locs = this.compact_locations;
            var indices = this.compact_indices;
            if ((indices.length>0) && (indices[0]>=0)) {
                mins = [locs[0], locs[1], locs[2]];
                maxes = [locs[0], locs[1], locs[2]];
                for (var i=0; i<indices.length; i++) {
                    if (indices[i]<0) {
                        break;
                    }
                    for (var k=0; k<3; k++) {
                        var v = locs[i*3 + k];
                        mins[k] = Math.min(mins[k], v);
                        maxes[k] = Math.max(maxes[k], v);
                    }
                }
            } else {
                mins = [0,0,0];
                maxes = [0,0,0];
            }
            var n2 = 0;
            var mid = [];
            if (mins) {
                // increase the maxes by offset in each dim
                maxes = this.vsum(maxes, s.dx);
                maxes = this.vsum(maxes, s.dy);
                maxes = this.vsum(maxes, s.dz);
                n2 = this.vdistance2(mins, maxes);
                for (var k=0; k<3; k++) {
                    mid.push(0.5 * (mins[k] + maxes[k]));
                    //n2 += (mins[k] - maxes[k]) ** 2;
                    var d = (mins[k] - maxes[k]);
                    n2 += d * d;
                }
            }
            this.compacted_feedbacks = {
                mid: mid,
                radius: 0.5 * Math.sqrt(n2),
                mins: mins,
                maxes: maxes,
                indices: this.compact_indices, 
                front_corners: this.compact_front_corners,
                back_corners: this.compact_back_corners,
                locations: this.compact_locations,
            };
            return this.compacted_feedbacks;
        };
        // XXX should get vector ops from somewhere else.
        vdistance2(v1, v2) {
            var result = 0.0;
            if ((v1) && (v2)) {
                for (var k=0; k<3; k++) {
                    var d = v1[k] - v2[k];
                    result += d * d;
                }
            }
            return result;
        };
        vsum(v1, v2) {
            var result = [];
            for (var k=0; k<3; k++) {
                result.push(v1[k] + v2[k]);
            }
            return result;
        };
        get_location_colors() {
            var indices = this.compact_indices;
            var locations = this.compact_locations;
            var feedbacks = this.compacted_feedbacks;
            var mins = feedbacks.mins;
            var maxes = feedbacks.maxes;
            var colors = this.compact_colors;
            if (!colors) {
                colors = new Float32Array(locations.length);
                this.compact_colors = colors;
            }
            if ((!indices) || (indices[0] < 0)) {
                return colors;  // no points: do nothing
            }
            var diffs = [];
            var base_intensity = 0.2;
            for (var j=0; j<3; j++) {
                var d = maxes[j] - mins[j];
                if (d < 1e-9) {
                    d = 1.0;
                }
                diffs.push(d / (1 - base_intensity));
            }
            for (var i=0; i<indices.length; i++) {
                if (indices[i]<0) {
                    break;
                }
                for (var j=0; j<3; j++) {
                    var ij = i * 3 + j;
                    colors[ij] = base_intensity + (locations[ij] - mins[j])/diffs[j];
                }
            }
            return colors;
        };
        reset_three_camera(camera, radius_multiple, orbit_control, radius, cx, cy, cz) {
            // adjust three.js camera to look at current voxels
            if (!radius) {
                var cf = this.compacted_feedbacks;
                if ((!cf) || (!cf.mins)) {
                    // no points -- punt
                    return;
                }
                cx = cf.mid[0];
                cy = cf.mid[1];
                cz = cf.mid[2];
                radius = cf.radius;
            }
            radius_multiple = radius_multiple || 3;
            camera.position.x = cx;
            camera.position.y = cy;
            camera.position.z = cz + radius_multiple * radius;
            camera.lookAt(cx, cy, cz);
            if (orbit_control) {
                orbit_control.center.x = cx;
                orbit_control.center.y = cy;
                orbit_control.center.z = cz;
            }
            return camera;
        }
        set_threshold(value) {
            this.settings.threshold = value;
            this.runner.change_uniform("uValue", [value]);
        };
        set_grid_limits(grid_mins, grid_maxes) {
            this.runner.change_uniform("u_grid_min", grid_mins);
            this.runner.change_uniform("u_grid_max", grid_maxes);
        };
    };

    var crossingVoxelsShader = function(grid_location_declaration) {
        return `#version 300 es

    // global length of rows
    uniform int uRowSize;

    // global number of columnss
    uniform int uColSize;

    // global number of layers (if values are in multiple blocks, else 0)
    uniform int uLayerSize;
    
    // global contour threshold
    uniform float uValue;

    // global grid thresholds
    //  (I tried integers but it didn't work, couldn't debug...)
    uniform vec3 u_grid_min, u_grid_max;

    // per mesh function values at voxel corners
    in float a000, a001, a010, a011, a100, a101, a110, a111;

    // corners feedbacks
    out vec4 front_corners, back_corners;

    // location feedback
    out vec3 location;

    // index feedback
    flat out int index;

    ${std_sizes_declarations}
    ${grid_location_declaration}

    void main() {
        // default to invalid index indicating the voxel does not cross the value.
        index = -1;
        front_corners = vec4(a000, a001, a010, a011);
        back_corners = vec4(a100, a101, a110, a111);

        ${get_sizes_macro("gl_VertexID")}
        //location = location_offset;
        vec3 rescaled = rescale_offset(vec3(0,0,0));
        //location = grid_location(vec3(0,0,0));
        location = grid_xyz(rescaled);

        bool voxel_ok = true;
        if (u_grid_min[0] < u_grid_max[0]) {
            // voxel coordinate filtering is enabled
            voxel_ok = ( 
                (u_grid_min[0] <= rescaled[0]) && (rescaled[0] < u_grid_max[0]) &&
                (u_grid_min[1] <= rescaled[1]) && (rescaled[1] < u_grid_max[1]) &&
                (u_grid_min[2] <= rescaled[2]) && (rescaled[2] < u_grid_max[2]) );
        }

        // Dont tile last column/row/layer which wraps around
        if ((voxel_ok) && 
            (i_col_num < (uRowSize - 1)) && 
            (i_row_num < (uColSize - 1)) &&
            (i_depth_num < (uLayerSize - 1))) {
            float m = front_corners[0];
            float M = front_corners[0];
            vec4 corners = front_corners;
            for (int j=0; j<2; j++) {
                for (int i=0; i<4; i++) {
                    float c = corners[i];
                    m = min(c, m);
                    M = max(c, M);
                }
                corners = back_corners;
            }
            if ((m <= uValue) && (M > uValue)) {
                // the pixel crosses the threshold
                index = gl_VertexID;
            }
        }
    }
    `;};

    $.fn.webGL2crossingVoxels.pointsMesh = function (options) {
        var settings = $.extend({
            THREE: null,   // required THREE instance
            locations: null,  // inifial points locations, required
            colors: null, // optional
            radius: 1.0,  // radius of bounding sphere
            center: [0, 0, 0],  // center of bounding sphere
            size: null,
        }, options);
        var THREE = settings.THREE;
        var locations = settings.locations;
        var c = settings.center;
        var size = settings.size || settings.radius * 0.01;
        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( locations, 3 ) );
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(c[0], c[1], c[2]), settings.radius);
        var vertex_colors = false;
        if (settings.colors) {
            geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( settings.colors, 3 ) );
            vertex_colors = true;
        }
        var material = new THREE.PointsMaterial( { size: size, vertexColors: vertex_colors } );
        var points = new THREE.Points( geometry, material );
        points.update_sphere_locations = function(locations) {
            geometry.attributes.position.array = locations;
            geometry.attributes.position.needsUpdate = true;
        };
        return points;
    };

    $.fn.webGL2crossingVoxels.spheresMesh = function (options) {
        var settings = $.extend({
            THREE: null,   // required THREE instance
            material: null, // material to use
            locations: null,  // inifial sphere locations
            radius: 1,  // shared radius for spheres
            width_segments: 10,
            height_segments: 10,
        }, options);
        var THREE = settings.THREE;
        var locations = settings.locations;
        var geometry = new THREE.SphereBufferGeometry( settings.radius, settings.width_segments, settings.height_segments);
        var count = Math.floor(locations.length/3);
        var mesh = new THREE.InstancedMesh( geometry, settings.material, count );
        mesh.update_sphere_locations = function(locations) {
            var matrixArray = mesh.instanceMatrix.array;
            var translation_offset = 12;
            var matrix_size = 16;
            for (var i=0; i<count; i++) {
                var matrixStart = i * matrix_size + translation_offset;
                var locationStart = i * 3;
                // copy the translation portion of the matrix from the location.
                for (var j=0; j<3; j++) {
                    matrixArray[matrixStart + j] = locations[locationStart + j];
                }
            }
            mesh.instanceMatrix.needsUpdate = true;
        };
        // set up all matrices
        var M = new THREE.Matrix4();
        for (var i=0; i<count; i++) {
            mesh.setMatrixAt( i, M );
        }
        mesh.update_sphere_locations(locations);
        return mesh;
    };

    $.fn.webGL2crossingVoxels.example = function (container) {
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
            0,0,0,
            0,0,0,
        ]);
        var crossing = container.webGL2crossingVoxels({
            feedbackContext: context,
            valuesArray: valuesArray,
            num_rows: 3,
            num_cols: 3,
            num_layers: 3, 
            threshold: 0.5,
            shrink_factor: 0.8,
        });
        var compacted = crossing.get_compacted_feedbacks();
        var indices = compacted.indices;
        var front_corners = compacted.front_corners;
        var back_corners = compacted.back_corners;
        var ci = 0;
        for (var i=0; i<indices.length; i++) {
            $("<br/>").appendTo(container);
            $("<span> " + indices[i] + " </span>").appendTo(container);
            for (var j=0; j<4; j++) {
                $("<span> " + front_corners[ci] + " " + back_corners[ci] + " </span>").appendTo(container);
                ci ++;
            }
        }
    };

    $.fn.webGL2sortedVoxels = function(options) {
        return new WebGL2SortedVoxels(options);
    };

    class WebGL2SortedVoxels extends WebGL2CrossingVoxels  {
        initialize() {
            var s = this.settings;
            this.feedbackContext = s.feedbackContext;
            //var nvalues = s.valuesArray.length;
            this.sorter = $.fn.webGL2voxelSorter({
                valuesArray: s.valuesArray,
                num_rows: s.num_rows,
                num_cols: s.num_cols,
                num_layers: s.num_layers,
                num_blocks: s.num_blocks,
            });
            // load buffers with sorter output arrays
            this.indices_buffer = this.feedbackContext.buffer();
            //this.front_corners_buffer = this.feedbackContext.buffer();
            //this.back_corners_buffer = this.feedbackContext.buffer();
            this.min_corners_buffer = this.feedbackContext.buffer();
            this.max_corners_buffer = this.feedbackContext.buffer();

            this.indices_buffer.initialize_from_array(this.sorter.indices);
            //this.front_corners_buffer.initialize_from_array(this.sorter.front_corners);
            //this.back_corners_buffer.initialize_from_array(this.sorter.back_corners);
            this.min_corners_buffer.initialize_from_array(this.sorter.min_corners);
            this.max_corners_buffer.initialize_from_array(this.sorter.max_corners);
            
            // allocate arrays to size limit
            this.compact_length = Math.floor(
                this.settings.shrink_factor * this.sorter.indices.length
            );
            // extended length for selection processing.
            this.compact_length = Math.min(this.compact_length, this.sorter.indices.length);
            this.extended_length = Math.min(4 * this.compact_length, this.sorter.indices.length);

            var vertex_shader;
            if (s.location == "std") {
                vertex_shader = sortedVoxelsShader(locate_std_decl);
            } else if (s.location="polar_scaled") {
                vertex_shader = sortedVoxelsShader(locate_polar_scaled_decl);
            } else {
                throw new Error("unknown grid location type: " + s.location);
            }

            this.program = this.feedbackContext.program({
                vertex_shader: vertex_shader,
                fragment_shader: this.settings.fragment_shader,
                feedbacks: {
                    index: {type: "int"},
                    location: {num_components: 3},
                },
            });
            var inputs = {};
            inputs.index_in = {
                per_vertex: true,
                num_components: 1,
                type: "int",
                from_buffer: {
                    name: this.indices_buffer.name,
                    skip_elements: 0,  // adjust for each run
                }
            };
            inputs.maxcorner = {
                per_vertex: true,
                num_components: 1,
                from_buffer: {
                    name: this.max_corners_buffer.name,
                    skip_elements: 0,  // adjust for each run
                }
            };
            inputs.mincorner = {
                per_vertex: true,
                num_components: 1,
                from_buffer: {
                    name: this.min_corners_buffer.name,
                    skip_elements: 0,  // adjust for each run
                }
            };

            this.runner = this.program.runner({
                num_instances: 1,
                vertices_per_instance: this.extended_length,
                rasterize: s.rasterize,
                uniforms: {
                    // number of rows
                    uRowSize: {
                        vtype: "1iv",
                        default_value: [s.num_cols],
                    },
                    // numver of columns
                    uColSize: {
                        vtype: "1iv",
                        default_value: [s.num_rows],
                    },
                    // number of layers
                    uLayerSize: {
                        vtype: "1iv",
                        default_value: [s.num_layers],
                    },
                    // threshold value
                    uValue: {
                        vtype: "1fv",
                        default_value: [s.threshold],
                    },
                    u_grid_min: {
                        vtype: "3fv",
                        default_value: s.grid_min,
                    },
                    u_grid_max: {
                        vtype: "3fv",
                        default_value: s.grid_max,
                    },
                },
                inputs: inputs,
                samplers: s.samplers,
            });

            this.front_corners_array = new Float32Array(4 * this.extended_length);
            this.back_corners_array = new Float32Array(4 * this.extended_length);
            this.index_array = new Int32Array(this.extended_length);
            this.location_array = new Float32Array(3 * this.extended_length);

            this.compact_front_corners = new Float32Array(4 * this.compact_length);
            this.compact_back_corners = new Float32Array(4 * this.compact_length);
            this.compact_indices = new Int32Array(this.compact_length);
            this.compact_locations = new Float32Array(3 * this.compact_length);
        };
        run() {
            var threshold = this.settings.threshold;
            var threshold_start = this.sorter.threshold_start_index(threshold);
            //var run_size = Math.min(this.sorter.indices.length - start_index, this.compact_length);
            var run_size = this.extended_length;
            var max_start = this.sorter.indices.length - run_size;
            var start_index = Math.min(max_start, threshold_start);
            var runner = this.runner;
            //runner.vertices_per_instance = run_size;
            runner.inputs.index_in.bindBuffer(this.indices_buffer, start_index);
            runner.inputs.maxcorner.bindBuffer(this.max_corner_buffer, start_index);
            runner.inputs.mincorner.bindBuffer(this.min_corner_buffer, start_index);
            this.runner.install_uniforms();
            this.runner.run();
            this.run_size = run_size;
            this.run_start_index = start_index;
        };
        get_feedbacks(location_only) {
            this.run();
            var rn = this.runner;
            // set index default to invalid voxel
            var index_array = this.index_array;
            for (var i=0; i<index_array.length; i++) {
                index_array[i] = -1;
            }
            this.index_array = rn.feedback_array(
                "index",
                index_array,
            );
            this.location_array = rn.feedback_array(
                "location",
                this.location_array,
            );
            if (!location_only) {
                var front_corners_array = this.front_corners_array;
                var back_corners_array = this.back_corners_array;
                var front_corners_src = this.sorter.front_corners;
                var back_corners_src = this.sorter.back_corners;
                var start_index = this.run_start_index;
                var run_size = this.run_size;
                var corners_index = 0;
                for (var out_index=0; out_index<run_size; out_index++) {
                    var corners_src = 4 * (out_index + start_index);
                    for (var corner_coord=0; corner_coord<4; corner_coord++) {
                        front_corners_array[corners_index] = front_corners_src[corners_src];
                        back_corners_array[corners_index] = back_corners_src[corners_src];
                        corners_index ++;
                        corners_src ++;
                    }
                }
            }
        }
        full_index_indicator_array() {
            // make a fresh copy of indicator_array[index]==index only if index is crossing
            // otherwise indicator_array[i] < 0 indicates not crossing.
            var result =  this.sorter.indices.slice(0);
            for (var i=0; i<result.length; i++) {
                result[i] = -1;  // default to not crossing
            }
            var index_array = this.index_array;
            for (var i=0; i<index_array.length; i++) {
                var index = index_array[i];
                if (index >= 0) {
                    result[index] = index;
                }
            }
            return result;
        };
    };
    var sortedVoxelsShader = function(grid_location_declaration) {
        return `#version 300 es

        // global length of rows
        uniform int uRowSize;
    
        // global number of columnss
        uniform int uColSize;
    
        // global number of layers (if values are in multiple blocks, else 0)
        uniform int uLayerSize;
        
        // global contour threshold
        uniform float uValue;
    
        // global grid thresholds
        //  (I tried integers but it didn't work, couldn't debug...)
        uniform vec3 u_grid_min, u_grid_max;

        // index input
        in int index_in;

        // voxel value extrema
        in float maxcorner, mincorner;
    
        // location feedback
        out vec3 location;
    
        // index feedback
        flat out int index;

        ${std_sizes_declarations}
        ${grid_location_declaration}

        void main() {
            ${get_sizes_macro("index_in")}
            // default to invalid index indicating the voxel does not cross the value.
            index = -1;
            vec3 rescaled = rescale_offset(vec3(0,0,0));
            location = grid_xyz(rescaled);
            bool voxel_ok = true;
            if (u_grid_min[0] < u_grid_max[0]) {
                // voxel coordinate filtering is enabled
                voxel_ok = ( 
                    (u_grid_min[0] <= rescaled[0]) && (rescaled[0] < u_grid_max[0]) &&
                    (u_grid_min[1] <= rescaled[1]) && (rescaled[1] < u_grid_max[1]) &&
                    (u_grid_min[2] <= rescaled[2]) && (rescaled[2] < u_grid_max[2]) );
            }
            if (voxel_ok) {
                voxel_ok = (mincorner <= uValue) && (maxcorner >= uValue);
            }
            if ((voxel_ok) && 
                (i_col_num < (uRowSize - 1)) && 
                (i_row_num < (uColSize - 1)) &&
                (i_depth_num < (uLayerSize - 1))) {
                // position is valid.
                index = index_in;
            }
        }
        `;
    }

    $.fn.webGL2sortedVoxels.example = function (container) {
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
            0,0,0,
            0,0,0,
        ]);
        var crossing = container.webGL2sortedVoxels({
            feedbackContext: context,
            valuesArray: valuesArray,
            num_rows: 3,
            num_cols: 3,
            num_layers: 3, 
            threshold: 0.5,
            shrink_factor: 1.0,
        });
        var compacted = crossing.get_compacted_feedbacks();
        var indices = compacted.indices;
        var front_corners = compacted.front_corners;
        var back_corners = compacted.back_corners;
        var ci = 0;
        for (var i=0; i<indices.length; i++) {
            $("<br/>").appendTo(container);
            $("<span> " + indices[i] + " </span>").appendTo(container);
            for (var j=0; j<4; j++) {
                $("<span> " + front_corners[ci] + " " + back_corners[ci] + " </span>").appendTo(container);
                ci ++;
            }
        }
    };

    $.fn.webGL2DiagonalInterpolation = function (options) {
        // For each voxel with crossing diagonals for an isosurface 
        // generate a weighted average of the diagonal interpolations as a
        // combined interpolation for the voxel.
        class WebGL2DiagonalInterpolation {
            constructor(options) {
                // There is a lot of similar code with WebGL2TriangulateVoxels xxxx refactor?
                this.settings = $.extend({
                    feedbackContext: null,
                    // array of indices (from crossing voxels)
                    indices: null,
                    // array of corners (from crossing voxels)
                    front_corners: null,
                    back_corners: null,
                    // volume dimensions
                    num_rows: null,
                    num_cols: null,
                    num_layers: 0,  // if >1 then indexing in multiple blocks
                    dx: [1, 0, 0],
                    dy: [0, 1, 0],
                    dz: [0, 0, 1],
                    translation: [0, 0, 0],
                    color: [1, 1, 1],
                    rasterize: false,
                    threshold: 0,  // value at contour
                    // invalid_coordinate: -100000,  // invalidity marker for positions
                    location: "std",
                    // samplers are prepared by caller if needed.  Descriptors provided by caller.
                    samplers: {},
                    // rotate the color direction using unit matrix
                    color_rotator: [
                        1, 0, 0,
                        0, 1, 0,
                        0, 0, 1,
                    ],
                    fragment_shader: tetrahedra_fragment_shader,
                    epsilon: 1e-10,
                }, options);
                var s = this.settings;
                this.feedbackContext = s.feedbackContext;

                // allocate and load buffers with a fresh name
                this.index_buffer = this.feedbackContext.buffer()
                this.index_buffer.initialize_from_array(s.indices);
                this.front_corner_buffer = this.feedbackContext.buffer()
                this.front_corner_buffer.initialize_from_array(s.front_corners);
                this.back_corner_buffer = this.feedbackContext.buffer()
                this.back_corner_buffer.initialize_from_array(s.back_corners);

                // each voxel is interpolated. triangles are constructed downstream.
                var vertices_per_instance = s.indices.length;
                var num_instances = 1;

                // xxxx refactor...
                var vertex_shader;
                if (s.location == "std") {
                    vertex_shader = crossingDiagonalsShader(locate_std_decl);
                } else if (s.location="polar_scaled") {
                    vertex_shader = crossingDiagonalsShader(locate_polar_scaled_decl);
                } else {
                    throw new Error("unknown grid location type: " + s.location);
                }

                this.program = this.feedbackContext.program({
                    vertex_shader: vertex_shader,
                    fragment_shader: this.settings.fragment_shader,
                    feedbacks: {
                        index_out: {type: "int"},
                        vPosition: {num_components: 3},
                        vNormal: {num_components: 3},
                        vColor: {num_components: 3},
                    },
                });

                this.runner = this.program.runner({
                    num_instances: num_instances,
                    vertices_per_instance: vertices_per_instance,
                    rasterize: this.settings.rasterize,
                    uniforms: {
                        uRowSize: {
                            vtype: "1iv",
                            default_value: [s.num_cols],
                        },
                        uColSize: {
                            vtype: "1iv",
                            default_value: [s.num_rows],
                        },
                        // number of layers
                        uLayerSize: {
                            vtype: "1iv",
                            default_value: [s.num_layers],
                        },
                        uValue: {
                            vtype: "1fv",
                            default_value: [s.threshold],
                        },
                        epsilon: {
                            vtype: "1fv",
                            default_value: [s.epsilon],
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
                        color_rotator: {
                            vtype: "3fv",
                            is_matrix: true,
                            default_value: s.color_rotator,
                        },
                    },
                    inputs: {
                        index: {
                            per_vertex: true,
                            num_components: 1,
                            type: "int",
                            from_buffer: {
                                name: this.index_buffer.name,
                            },
                        },
                        front_corners: {
                            per_vertex: true,
                            num_components: 4,
                            from_buffer: {
                                name: this.front_corner_buffer.name,
                            },
                        },
                        back_corners: {
                            per_vertex: true,
                            num_components: 4,
                            from_buffer: {
                                name: this.back_corner_buffer.name,
                            },
                        },
                    },
                    samplers: s.samplers,
                });
            };
            run() {
                this.runner.install_uniforms();
                this.runner.run();
            };
            set_threshold(value) {
                //this.runner.uniforms.uValue.value = [value];
                this.runner.change_uniform("uValue", [value]);
                //this.runner.run();
            };
            set_color_rotator(value) {
                this.runner.change_uniform("color_rotator", value);
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
            get_indices(optionalPreAllocatedArrBuffer) {
                return this.runner.feedback_array(
                    "index_out",
                    optionalPreAllocatedArrBuffer);
            };
        };

        // XXXX THERE IS A LOT OF PASTED CODE FROM crossingVoxelShader below -- should refactor/unify
        var crossingDiagonalsShader = function(grid_location_declaration) {
            return `#version 300 es

        // global length of rows
        uniform int uRowSize;

        // global number of columnss
        uniform int uColSize;

        // global number of layers (if values are in multiple blocks, else 0)
        uniform int uLayerSize;
        
        // global contour threshold
        uniform float uValue;

        // uniform offsets in xyz directions
        // applied after grid relative computations, compatible with triangulate_vertex_shader
        uniform vec3 dx, dy, dz, translation;

        // color rotator for converting normals to colors
        uniform mat3 color_rotator;

        // small positive cut_off value
        uniform float epsilon;

        // per mesh corner values
        in vec4 front_corners, back_corners;

        // per mesh ravelled voxel index
        in int index;

        // feedbacks out
        out vec3 vColor, vPosition, vNormal;

        // index feedback (validity indicator, negative==not valid)
        flat out int index_out;

        ${std_sizes_declarations}
        ${grid_location_declaration}

        void main() {
            // default to invalid index indicating the voxel does not have an interpolation
            index_out = -1;
            vPosition = vec3(-1.0, -1.0, -1.0);
            vNormal = vPosition;
            vColor = vPosition;

            if (index >= 0) {   // don't process invalid index.
                ${get_sizes_macro("index")}

                // unpack corner values
                float a000 = front_corners[0];
                float a001 = front_corners[1];
                float a010 = front_corners[2];
                float a011 = front_corners[3];

                float a100 = back_corners[0];
                float a101 = back_corners[1];
                float a110 = back_corners[2];
                float a111 = back_corners[3];

                // Compute the combined interpolated position
                float[4] diagonal_start_values = float[] (
                    a000,
                    a100,
                    a010,
                    a110
                );
                float[4] diagonal_end_values = float[] (
                    a111,
                    a011,
                    a101,
                    a001
                );
                // corner positions
                vec3 p000 = grid_location(vec3(0.0, 0.0, 0.0));
                vec3 p001 = grid_location(vec3(0.0, 0.0, 1.0));
                vec3 p010 = grid_location(vec3(0.0, 1.0, 0.0));
                vec3 p011 = grid_location(vec3(0.0, 1.0, 1.0));
                vec3 p100 = grid_location(vec3(1.0, 0.0, 0.0));
                vec3 p101 = grid_location(vec3(1.0, 0.0, 1.0));
                vec3 p110 = grid_location(vec3(1.0, 1.0, 0.0));
                vec3 p111 = grid_location(vec3(1.0, 1.0, 1.0));
                // diagonal positions
                vec3[4] diagonal_start_positions = vec3[] (
                    p000,
                    p100,
                    p010,
                    p110
                );
                vec3[4] diagonal_end_positions = vec3[] (
                    p111,
                    p011,
                    p101,
                    p001
                );
                // compute weighted sum
                bool found = false;
                vec3 position_sum = vec3(0.0, 0.0, 0.0);
                float offset_sum = 0.0;
                for (int i_diagonal=0; i_diagonal<4; i_diagonal++) {
                    float start_value = diagonal_start_values[i_diagonal];
                    float end_value = diagonal_end_values[i_diagonal];
                    // does the diagonal cross the isosurface threshold uValue?
                    float d_start = start_value - uValue;
                    float d_end = end_value - uValue;
                    if ( (d_start * d_end) <= 0.0 ) {
                        found = true;
                        vec3 start_position = diagonal_start_positions[i_diagonal];
                        vec3 end_position = diagonal_end_positions[i_diagonal];
                        float d = start_value - end_value;
                        float lambda = 0.0;
                        if (abs(d) > epsilon) {
                            lambda = d_start / d;
                        }
                        float lambda1 = 1.0 - lambda;
                        vec3 diagonal_interpolation = (lambda1 * start_position) + (lambda * end_position);
                        float offset = max(epsilon, min(lambda, lambda1));
                        // weighted sum by nearest relative distance to corner (or epsilon if too small)
                        position_sum += diagonal_interpolation * offset;
                        offset_sum += offset;
                    }
                }
                if (found) {
                    // there is an interpolation.
                    index_out = index;  // position is valid
                    // weighted average position.
                    vec3 vertex = position_sum / offset_sum;
                    // Converted position feedback:
                    vPosition = dx * vertex[0] + dy * vertex[1] + dz * vertex[2] + translation;

                    // compute normal

                    // first attempt:
                    //vec3 d = vec3(a100 - a000, a010 - a000, a001 - a000);
                    // column major declaration
                    //mat3 Mtranspose = mat3 (p100 - p000, p010 - p000, p001 - p000);

                    // second attempt:
                    vec3 d = vec3(a111 - a000, a010 - a101, a001 - a110);
                    // column major declaration
                    mat3 Mtranspose = mat3 (p111 - p000, p010 - p101, p001 - p110);
                    mat3 M = transpose(Mtranspose);
                    mat3 Minv = inverse(M);
                    vec3 n = Minv * d;
                    // rotate normal
                    n = dx * n[0] + dy * n[1] + dz * n[2];
                    float ln = length(n);
                    if (ln > epsilon) {
                        vNormal = n / ln;
                    } else {
                        vNormal = vec3(1.0, 0.0, 0.0);  // ??? arbitrary...
                    }
                    vColor = normalize(1.0 + (color_rotator * vNormal));
                }
            }
        }
        `;};
        return new WebGL2DiagonalInterpolation(options);
    };
    
    $.fn.webGL2DiagonalInterpolation.example = function (container) {
        var gl = $.fn.feedWebGL2.setup_gl_for_example(container);

        var context = container.feedWebGL2({
            gl: gl,
        });

        var front_cornersArray = new Float32Array([
            0, 0, 0, 0,
            0, 0, 0 ,1,
            0, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 0,
            1, 0, 0, 0,
            -1.,-1,-1,-1, 
            -1.,-1,-1,-1, 
            -1.,-1,-1,-1, 
        ]);
        var back_cornersArray = new Float32Array([
            0, 0, 0, 1,
            0, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 0,
            1, 0, 0, 0,
            0, 0, 0, 0,
            -1.,-1,-1,-1, 
            -1.,-1,-1,-1, 
            -1.,-1,-1,-1, 
        ]);
        var indexArray = new Int32Array([
            0,1,3,4,9,10,12,13,-1,-1,-1
        ]);
        var interpolator = container.webGL2DiagonalInterpolation({
            feedbackContext: context,
            indices: indexArray,
            front_corners: front_cornersArray,
            back_corners: back_cornersArray,
            num_rows: 3,
            num_cols: 3,
            rasterize: true,
            dx: [0.3, 0, 0],
            dy: [0, 0.3, 0],
            dz: [0, 0, 0.3],
            threshold: 0.5,
        });
        interpolator.run();
        var positions = interpolator.get_positions();
        var indices = interpolator.get_indices();
        for (var i=0; i<indices.length; i++) {
            $("<br/>").appendTo(container);
            $("<span> " + indices[i] + " </span>").appendTo(container);
            for (var j=0; j<3; j++) {
                $("<span> " + positions[i*3 + j] + " </span>").appendTo(container);
            }
        }
        return interpolator;
    };

    $.fn.webGL2TriangulateVoxels = function (options) {
        class WebGL2TriangulateVoxels {

            constructor(options) { 
                this.settings = $.extend({
                    feedbackContext: null,
                    // array of indices (from crossing voxels)
                    indices: null,
                    // array of corners (from crossing voxels)
                    front_corners: null,
                    back_corners: null,
                    // volume dimensions
                    num_rows: null,
                    num_cols: null,
                    num_layers: 0,  // if >1 then indexing in multiple blocks
                    dx: [1, 0, 0],
                    dy: [0, 1, 0],
                    dz: [0, 0, 1],
                    translation: [0, 0, 0],
                    color: [1, 1, 1],
                    rasterize: false,
                    threshold: 0,  // value at contour
                    invalid_coordinate: -100000,  // invalidity marker for positions
                    location: "std",
                    // samplers are prepared by caller if needed.  Descriptors provided by caller.
                    samplers: {},
                    // rotate the color direction using unit matrix
                    color_rotator: [
                        1, 0, 0,
                        0, 1, 0,
                        0, 0, 1,
                    ],
                }, options);
                var s = this.settings;
                this.feedbackContext = s.feedbackContext;

                // allocate and load buffers with a fresh name
                this.index_buffer = this.feedbackContext.buffer()
                this.index_buffer.initialize_from_array(s.indices);
                this.front_corner_buffer = this.feedbackContext.buffer()
                this.front_corner_buffer.initialize_from_array(s.front_corners);
                this.back_corner_buffer = this.feedbackContext.buffer()
                this.back_corner_buffer.initialize_from_array(s.back_corners);
                // add vertex count bogus input for Firefox
                const N_TETRAHEDRA = 6;
                const N_TRIANGLES = 2;  
                const N_VERTICES = 3;
                var vertices_per_instance = N_TETRAHEDRA * N_TRIANGLES * N_VERTICES;
                this.vertices_per_instance = vertices_per_instance;
                // add vertex count bogus input for Firefox
                var vertexNumArray = new Float32Array(Array.from(Array(vertices_per_instance).keys()));
                this.vertex_num_buffer = this.feedbackContext.buffer()
                this.vertex_num_buffer.initialize_from_array(vertexNumArray);

                var vertex_shader;
                if (s.location == "std") {
                    vertex_shader = triangulate_vertex_shader(locate_std_decl);
                } else if (s.location="polar_scaled") {
                    vertex_shader = triangulate_vertex_shader(locate_polar_scaled_decl);
                    //vertex_shader = triangulate_vertex_shader(locate_std_decl);
                } else {
                    throw new Error("unknown grid location type: " + s.location);
                }

                this.program = this.feedbackContext.program({
                    vertex_shader: vertex_shader,
                    fragment_shader: tetrahedra_fragment_shader,
                    feedbacks: {
                        vPosition: {num_components: 3},
                        vNormal: {num_components: 3},
                        vColor: {num_components: 3},
                    },
                })

                this.runner = this.program.runner({
                    run_type: "TRIANGLES",
                    num_instances: s.indices.length,
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
                        // number of layers
                        uLayerSize: {
                            vtype: "1iv",
                            default_value: [s.num_layers],
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
                        color_rotator: {
                            vtype: "3fv",
                            is_matrix: true,
                            default_value: s.color_rotator,
                        },
                    },
                    inputs: {
                        index: {
                            per_vertex: false,
                            num_components: 1,
                            type: "int",
                            from_buffer: {
                                name: this.index_buffer.name,
                            },
                        },
                        front_corners: {
                            per_vertex: false,
                            num_components: 4,
                            from_buffer: {
                                name: this.front_corner_buffer.name,
                            },
                        },
                        back_corners: {
                            per_vertex: false,
                            num_components: 4,
                            from_buffer: {
                                name: this.back_corner_buffer.name,
                            },
                        },
                        aVertexCount: {   // bogus attribute required by Firefox
                            per_vertex: true,
                            num_components: 1,
                            from_buffer: {
                                name: this.vertex_num_buffer.name,
                            },
                        },
                    },
                    samplers: s.samplers,
                });
            };
            run() {
                this.runner.install_uniforms();
                this.runner.run();
            };
            set_threshold(value) {
                //this.runner.uniforms.uValue.value = [value];
                this.runner.change_uniform("uValue", [value]);
                //this.runner.run();
            };
            set_color_rotator(value) {
                this.runner.change_uniform("color_rotator", value);
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

        var triangulate_vertex_shader = function(grid_location_declaration) {
            return `#version 300 es

        // global length of rows, cols inputs
        uniform int uRowSize;
        uniform int uColSize;
        // global number of layers (if values are in multiple blocks, else 0)
        uniform int uLayerSize;
        
        // global contour threshold input
        uniform float uValue;
        
        // uniform offsets in xyz directions
        uniform vec3 dx, dy, dz, translation;

        // color rotator for converting normals to colors
        uniform mat3 color_rotator;
        
        // invalid value marker
        uniform float uInvalid;

        // per mesh corner values
        in vec4 front_corners, back_corners;

        // per mesh ravelled voxel index
        in int index;

        // bogus vertex attribute required by Firefox (but not Chrome)
        in float aVertexCount;

        // feedbacks out
        out vec3 vColor, vPosition, vNormal;

        // Which vertex in which triangle on which tetrahedron?
        //   gl_VertexID encodes tetrahedron_number 0..4, triangle_number 0..1, vertex number 0..2
        //   for a total of 6 * 2 * 3 = 36 vertices per "mesh instance".
        //   aVertexCount = tetrahedron_number * 10 + triangle_number * 3 + vertex_number;
        const int N_TETRAHEDRA = 6; // tetrahedra per cube
        const int N_TRIANGLES = 2;  // triangles per tetrahedron
        const int N_VERTICES = 3;   // vertices per triangle
        const int N_CORNERS = 8;    // number of cube corners
        const int N_T_VERTICES = 4; // number of vertices in a tetrahedron

        // Crossing index is binary integer associated with each tetrahedron of form
        //   (triangle_num << 4) || ((fA > v) << 3 || ((fB > v) << 2 || ((fC > v) << 1 || ((fD > v)
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

        ${std_sizes_declarations}
        ${grid_location_declaration}

        void main() {

            // initially set output point to invalid
            gl_Position = vec4(uInvalid, uInvalid, uInvalid, uInvalid);
            vPosition = gl_Position.xyz;
            // use the bogus vertexCount parameter so it is not erased by the optimizer
            float grey = aVertexCount / float(N_TETRAHEDRA * N_TRIANGLES * N_VERTICES);
            vColor = vec3(float(gl_VertexID) * 0.01, grey, 0.0);  // temp value for debugging
            vNormal = vec3(0.0, 0.0, 1.0);    // arbitrary initial value

            ${get_sizes_macro("index")}

            // Dont tile last column which wraps around or last row
            if ((index >= 0) && (i_col_num < (uRowSize - 1)) && (i_row_num < (uColSize - 1))) {
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
                vec3[4] grid_locations = vec3[](
                    grid_location(t_offsets[0]),
                    grid_location(t_offsets[1]),
                    grid_location(t_offsets[2]),
                    grid_location(t_offsets[3])
                );
                // weights as array
                float wts[N_CORNERS] = float[](
                    front_corners[0], front_corners[1], front_corners[2], front_corners[3], 
                    back_corners[0], back_corners[1], back_corners[2], back_corners[3]);
                    // a000, a001, a010, a011, a100, a101, a110, a111
                // weights of vertices for this tet number
                float t_wts[N_T_VERTICES] = float[](
                    wts[A_INDEX],
                    wts[B_index[iTetrahedronNumber]],
                    wts[C_index[iTetrahedronNumber]],
                    wts[D_INDEX]
                );
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
                    vec3[N_VERTICES] combined_offsets;
                    // compute intercepts for all vertices of the triangle
                    for (int vnum=0; vnum<N_VERTICES; vnum++) {
                        int SegL = SegLs[vnum];
                        int SegR = SegRs[vnum];
                        vec3 offsetL = grid_locations[SegL];
                        vec3 offsetR = grid_locations[SegR];
                        float wtL = t_wts[SegL];
                        float wtR = t_wts[SegR];
                        // check denominator is not too small? xxxx
                        float delta = (wtL - uValue) / (wtL - wtR);
                        combined_offsets[vnum] = ((1.0 - delta) * offsetL) + (delta * offsetR);
                    }
                    vec3 vertex = combined_offsets[iVertexNumber];
                    vPosition = dx * vertex[0] + dy * vertex[1] + dz * vertex[2] + translation;
                    gl_Position.xyz = vPosition;
                    gl_Position[3] = 1.0;
                    //vdump = float[4](vertex[0], vertex[1], vertex[2], delta);

                    // compute normal
                    vec3 nm = cross(combined_offsets[1] - combined_offsets[0], combined_offsets[2] - combined_offsets[0]);
                    // rotate normal
                    nm = dx * nm[0] + dy * nm[1] + dz * nm[2];
                    float ln = length(nm);
                    if (ln > 1e-12) {
                        vNormal = nm / ln;
                    }
                    //vColor = abs(vNormal);  // XXX FOR TESTING ONLY
                    vec3 colorVector = 1.0 + (color_rotator * vNormal);
                    vColor = normalize(colorVector);
                }
            }
            //vPosition = gl_Position.xyz;
        }
        `;};

        return new WebGL2TriangulateVoxels(options);
    };

    var tetrahedra_fragment_shader = `#version 300 es
        #ifdef GL_ES
            precision highp float;
        #endif
        in vec3 vColor;
        out vec4 color;

        void main() {
            color = vec4(vColor, 1.0);
            // DEBUGGING
            color = vec4(1.0, 0, 0, 1.0);
        }
        `;

    $.fn.webGL2TriangulateVoxels.example = function (container) {
        var gl = $.fn.feedWebGL2.setup_gl_for_example(container);

        var context = container.feedWebGL2({
            gl: gl,
        });
        /*
        Copied from data dump:

        0 0 0 0 0 0 0 0 1
        1 0 0 0 0 0 0 1 0
        3 0 0 0 1 0 0 0 0
        4 0 0 1 0 0 0 0 0
        9 0 0 0 0 0 1 0 0
        10 0 0 0 0 1 0 0 0
        12 0 1 0 0 0 0 0 0
        13 1 0 0 0 0 0 0 0
        -1 -1 -1 -1 -1 -1 -1 -1 -1
        -1 -1 -1 -1 -1 -1 -1 -1 -1
        -1 -1 -1 -1 -1 -1 -1 -1 -1

        First column is index, alternating columns are front/back corners after.
        */
        var front_cornersArray = new Float32Array([
            0, 0, 0, 0,
            0, 0, 0 ,1,
            0, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 0,
            1, 0, 0, 0,
            -1.,-1,-1,-1, 
            -1.,-1,-1,-1, 
            -1.,-1,-1,-1, 
        ]);
        var back_cornersArray = new Float32Array([
            0, 0, 0, 1,
            0, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 0,
            1, 0, 0, 0,
            0, 0, 0, 0,
            -1.,-1,-1,-1, 
            -1.,-1,-1,-1, 
            -1.,-1,-1,-1, 
        ]);
        var indexArray = new Int32Array([
            0,1,3,4,9,10,12,13,-1,-1,-1
        ]);
        var segments = container.webGL2TriangulateVoxels({
            feedbackContext: context,
            indices: indexArray,
            front_corners: front_cornersArray,
            back_corners: back_cornersArray,
            num_rows: 3,
            num_cols: 3,
            rasterize: true,
            dx: [0.3, 0, 0],
            dy: [0, 0.3, 0],
            dz: [0, 0, 0.3],
            threshold: 0.5,
        });
        segments.run();
        var positions = segments.get_positions();
        for (var i=0; i<positions.length; i++) {
            if (i % 3 == 0) {
                $("<br/>").appendTo(container);
            }
            $("<span> " + positions[i] + " </span>").appendTo(container);
        }
    };

    // "optimized surfaces" by truncating buffer sizes
    // which may result in some data omission in dense cases.
    class WebGL2Surfaces3dOpt {
        constructor(options) {
            var that = this;
            this.settings = $.extend({
                // default settings:
                shrink_factor: 0.1, // how much to shrink buffers
                feedbackContext: null,    // the underlying FeedbackContext context to use
                valuesArray: null,   // the array buffer of values to contour
                num_rows: null,
                num_cols: null,
                num_layers: 1,  // default to "flat"
                num_blocks: 1,
                //dx: [1, 0, 0],
                //dy: [0, 1, 0],
                //dz: [0, 0, 1],
                //translation: [-1, -1, 0],
                //color: [1, 1, 1],   ??? not used???
                rasterize: false,
                threshold: 0,  // value at contour
                invalid_coordinate: -100000,  // invalidity marker for positions, must be very negative
                grid_min: [0, 0, 0],
                grid_max: [-1, -1, -1],  // disabled grid coordinate filtering (invalid limits)
                after_run_callback: null,   // call this after each run.
                // method of conversion from grid coordinates to world coordinates
                location: "std", 
                // parameters needed by location method if any.
                location_parameters: null,
                // rotate the color direction using unit matrix
                color_rotator: [
                    1, 0, 0,
                    0, 1, 0,
                    0, 0, 1,
                ],
                // use sorted voxel implementation by default.
                sorted: true,
            }, options);
            this.check_geometry();
            var s = this.settings;
            this.feedbackContext = s.feedbackContext;
            var container = $(this.feedbackContext.canvas);
            if (!this.feedbackContext) {
                throw new Error("Feedback context required.");
            }
            var nvalues = s.valuesArray.length;
            var nvoxels = s.num_rows * s.num_cols * s.num_layers * s.num_blocks;
            if (nvalues != nvoxels) {
                // for now strict checking
                throw new Error("voxels " + nvoxels + " don't match values " + nvalues);
            }
            // samplers for location conversion, if any
            this.samplers = {};
            this.textures = {}
            if (s.location == "polar_scaled") {
                // set up scaling textures
                this.samplers.RowScale = this.feedbackContext.texture("RowScale", "FLOAT", "RED", "R32F");
                var set_up_sampler = function(name, size) {
                    var texture = that.feedbackContext.texture(name, "FLOAT", "RED", "R32F");
                    texture.load_array(s.location_parameters[name], size, s.num_blocks)
                    that.textures[name] = texture;
                    that.samplers[name] = {dim: "2D", from_texture: name};
                };
                set_up_sampler("RowScale", s.num_rows+1);
                set_up_sampler("ColumnScale", s.num_cols+1);
                set_up_sampler("LayerScale", s.num_layers+1);
            }
            var crossing_maker = container.webGL2crossingVoxels;
            if (s.sorted) {
                var crossing_maker = container.webGL2sortedVoxels;
            }
            this.crossing = crossing_maker({
                feedbackContext: this.feedbackContext,
                valuesArray: s.valuesArray,
                num_rows: s.num_rows,
                num_cols: s.num_cols,
                num_layers: s.num_layers,
                num_blocks: s.num_blocks,
                threshold: s.threshold,
                shrink_factor: s.shrink_factor,
                grid_min: s.grid_min,
                grid_max: s.grid_max,  // disabled grid coordinate filtering (invalid limits)
                location: s.location,
                samplers: this.samplers,
                // never rasterize the crossing pixels
                dx: s.dx,
                dy: s.dy,
                dz: s.dz,
            });
            // initialize segmenter upon first run.
            this.segments = null;
            // named perspectives which share this underlying surface data structure
            this.named_perspectives = {};
        };
        connected_voxel_count() {
            debugger;
            return this.crossing.connected_voxel_count;
        };
        get_perspective(name, options) {
            options = options || {};
            options.name = name;
            var perspective = new webGL2SurfacePerspective(options);
            this.named_perspectives[name] = perspective;
            return perspective;
        };
        reset_perspectives() {
            // mark all perspectives as invalid (use before generating new geometry)
            for (var name in this.named_perspectives) {
                this.named_perspectives[name].reset();
            }
        };
        check_geometry() {
            // arrange the geometry parameters to fit in [-1:1] cube unless specified otherwise
            var s = this.settings;
            if (s.location != "std") {
                return;  // don't mess with non-standard geometry
            }
            if (!s.dx) {
                // geometry needs specifying:
                var max_dimension = Math.max(s.num_rows, s.num_cols, s.num_layers);
                var dpixel = 2.0 / max_dimension;
                s.dx = [dpixel, 0, 0];
                s.dy = [0, dpixel, 0];
                s.dz = [0, 0, dpixel];
                if (!s.translation) {
                    s.translation = [-0.5 * s.num_cols * dpixel, -0.5 * s.num_rows * dpixel, -0.5 * s.num_layers * dpixel]
                }
            }
        }
        set_seed (xyz_block) {
            this.crossing.set_seed(xyz_block);
        };
        run () {
            var s = this.settings;
            var compacted = this.crossing.get_compacted_feedbacks();
            this.radius = compacted.radius;
            this.mid_point = compacted.mid;
            if (!this.segments) {
                this.segments = this.get_segments(compacted);
            } else {
                // reset buffer content
                this.segments.index_buffer.copy_from_array(
                    compacted.indices
                );
                this.segments.front_corner_buffer.copy_from_array(
                    compacted.front_corners
                );
                this.segments.back_corner_buffer.copy_from_array(
                    compacted.back_corners
                );
            }
            this.indices = compacted.indices;
            this.vertices_per_instance = this.segments.vertices_per_instance;
            this.segments.run();
            this.run_postprocessing();
            var after_run_callback = this.settings.after_run_callback;
            if (after_run_callback) {
                after_run_callback(this);
            }
            //var positions = segments.get_positions();
        };
        run_postprocessing() {
            // do nothing here (for subclassing)
        }
        get_segments(compacted) {
            var s = this.settings;
            var container = $(this.feedbackContext.canvas);
            this.segments = container.webGL2TriangulateVoxels({
                feedbackContext: this.feedbackContext,
                indices: compacted.indices,
                front_corners: compacted.front_corners,
                back_corners: compacted.back_corners,
                num_rows: s.num_rows,
                num_cols: s.num_cols,
                num_layers: s.num_layers,
                num_blocks: s.num_blocks,
                rasterize: s.rasterize,
                dx: s.dx,
                dy: s.dy,
                dz: s.dz,
                translation: s.translation,
                threshold: s.threshold,
                invalid_coordinate: s.invalid_coordinate,
                location: s.location,
                samplers: this.samplers,
                color_rotator: s.color_rotator,
            });
            return this.segments;
        };
        colorization(voxel_color_source, vertex_color_destination) {
            // apply voxel colors to vertices for active voxel indices
            var indices = this.indices;
            var vertices_per_instance = this.vertices_per_instance;
            var skip_index = vertices_per_instance * 3;
            var num_indices = indices.length;
            var count = 0;
            for (var i=0; i<num_indices; i++){
                var index = indices[i];
                if (index < 0) {
                    count += skip_index;
                } else {
                    var cindex = 3 * index;
                    for (var vn=0; vn<vertices_per_instance; vn++) {
                        for (var cn=0; cn<3; cn++) {
                            vertex_color_destination[count] = voxel_color_source[cindex + cn];
                            count ++;
                        }
                    }
                }
            }
            return vertex_color_destination;
        };
        linked_three_geometry (THREE, clean, normal_binning) {
            // create a three.js geometry linked to the current positions feedback array.
            // xxxx multiple linked geometries may interfere with eachother unless carefully managed.
            // this is a bit convoluted in an attempt to only update attributes when needed.
            var that = this;
            var positions, normals;
            if (clean) {
                var pn = this.clean_positions_and_normals(normal_binning);
                positions = pn.positions;
                normals = pn.normals;
            } else {
                positions = this.get_positions();
                normals = this.get_normals();
            }
            var colors = this.get_colors();  // xxxx remove this? (debug only)
            var geometry = new THREE.BufferGeometry();
            geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
            geometry.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );
            geometry.setAttribute( 'color', new THREE.BufferAttribute( colors, 3 ) );
            that.link_needs_update = false;
            var after_run = function(that) {
                that.link_needs_update = true;
            }
            var check_update_link = function(nbins) {
                // update the surface if needed, using nbins for normal_binning if provided.
                var do_clean = clean || nbins;
                var bin_size = nbins || normal_binning;
                // update the geometry positions array in place and mark for update in geometry
                if ((!that.link_needs_update) && (!nbins)) {
                    // only update upon request and only if needed, or if binning was specified
                    that.link_needs_update = false;
                    return;
                }
                var positions, normals;
                if (do_clean) {
                    var pn = that.clean_positions_and_normals(bin_size);
                    positions = pn.positions;
                    normals = pn.normals;
                } else {
                    positions = that.get_positions(geometry.attributes.position.array);
                    normals = that.get_normals(geometry.attributes.normal.array);
                }
                var mid = that.mid_point;
                geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(mid[0], mid[1], mid[2]), that.radius);
                geometry.attributes.position.array = positions;
                geometry.attributes.position.needsUpdate = true;
                geometry.attributes.normal.array = normals;
                geometry.attributes.normal.needsUpdate = true;
                geometry.attributes.color.array = that.get_colors(geometry.attributes.color.array);
                geometry.attributes.color.needsUpdate = true;
                that.link_needs_update = false;
            }
            this.settings.after_run_callback = after_run;
            this.check_update_link = check_update_link;
            geometry.check_update_link = check_update_link;
            return geometry;
        };
        clean_positions_and_normals(normal_binning, truncate) {
            var positions = this.get_positions();
            var normals = this.get_normals();
            var nfloats = positions.length;
            var clean_positions = new Float32Array(nfloats);
            var clean_normals = new Float32Array(nfloats);
            var clean_length = 0;
            var tetrahedron_indices = this.crossing.compact_indices;
            var vertices_per_tetrahedron = this.segments.vertices_per_instance;
            var too_small = this.settings.invalid_coordinate + 1;
            var maxes = null;
            var mins = null;
            for (var i=0; i<tetrahedron_indices.length; i++) {
                if (tetrahedron_indices[i] < 0) {
                    break;  // sentinel: end of valid tetrahedron indices
                }
                var tetrahedron_start = 3 * i * vertices_per_tetrahedron;
                for (var vj=0; vj<vertices_per_tetrahedron; vj++) {
                    var vertex_start = 3 * vj + tetrahedron_start;
                    if (positions[vertex_start] > too_small) {
                        if (!maxes) {
                            maxes = [];
                            mins = [];
                            for (var k=0; k<3; k++) {
                                var p = positions[vertex_start + k];
                                maxes.push(p);
                                mins.push(p);
                            }
                        }
                        for (var k=0; k<3; k++) {
                            var copy_index = vertex_start + k;
                            var p = positions[copy_index];
                            maxes[k] = Math.max(maxes[k], p);
                            mins[k] = Math.min(mins[k], p)
                            clean_positions[clean_length] = p;
                            clean_normals[clean_length] = normals[copy_index];
                            clean_length++;
                        }
                    }
                }
            }
            if (normal_binning && (clean_length > 0)) {
                // unify geometrically close normal values
                var key_to_normal = {};
                var denominators = [];
                for (var i=0; i<3; i++) {
                    var d = maxes[i] - mins[i];
                    if (d < 1e-17) {
                        d = 1.0
                    }
                    denominators.push(d);
                }
                var position_bin_key = function (vertex_index) {
                    var key = 0;
                    var vertex_start = 3 * vertex_index;
                    for (var k=0; k<3; k++) {
                        key = normal_binning * key;
                        var coordinate = clean_positions[vertex_start + k];
                        var k_offset = Math.floor(normal_binning * (coordinate - mins[k])/denominators[k]);
                        key += k_offset;
                    }
                    return key;
                };
                var n_vertices = clean_length / 3;
                var vertex_to_key = {};
                var key_to_normal_sum = {};
                for (var vi=0; vi<n_vertices; vi++) {
                    var key = position_bin_key(vi);
                    vertex_to_key[vi] = key;
                    var ns = key_to_normal_sum[key];
                    if (!ns) {
                        ns = [0, 0, 0];
                    }
                    var vertex_start = vi * 3;
                    for (var k=0; k<3; k++) {
                        ns[k] += clean_normals[vertex_start + k];
                    }
                    key_to_normal_sum[key] = ns;
                }
                // renormalize
                for (var k in key_to_normal_sum) {
                    var ns = key_to_normal_sum[k];
                    var n = 0;
                    for (var k=0; k<3; k++) {
                        n += ns[k] * ns[k];
                    }
                    if (n < 1e-10) {
                        n = 1.0;
                    }
                    n = Math.sqrt(n);
                    for (var k=0; k<3; k++) {
                        ns[k] = ns[k] / n;
                    }
                    key_to_normal_sum[k] = ns;
                }
                // apply unified normals
                for (var vi=0; vi<n_vertices; vi++) {
                    var vertex_start = vi * 3;
                    var key = vertex_to_key[vi];
                    var ns = key_to_normal_sum[key];
                    for (var k=0; k<3; k++) {
                        clean_normals[vertex_start + k] = ns[k];
                    }
                }
            }
            if (truncate) {
                // use slice (not aubarray) so the buffer is not shared (?)
                clean_positions = clean_positions.slice(0, clean_length);
                clean_normals = clean_normals.slice(0, clean_length);
            }
            return {
                positions: clean_positions,
                normals: clean_normals,
                length: clean_length,
                maxes: maxes,
                mins: mins,
            }
        }
        set_grid_limits(grid_mins, grid_maxes) {
            this.crossing.set_grid_limits(grid_mins, grid_maxes);
        };
        set_threshold(value) {
            this.settings.threshold = value;
            this.crossing.set_threshold(value);
            // xxxx must be after first run!
            if (this.segments) {
                this.segments.set_threshold(value);
            }
        };
        set_color_rotator(value) {
            this.settings.color_rotator = value;
            if (this.segments) {
                this.segments.set_color_rotator(value);
            }
        };
        get_positions(a) {
            return this.segments.get_positions(a);
        };
        get_normals(a) {
            return this.segments.get_normals(a);
        };
        get_colors(a) {
            return this.segments.get_colors(a);
        };
    };

    class webGL2SurfacePerspective {
        // A view of the surface at a specified threshold and color rotation, etc.
        // The underlying surface may be shared between many perspectives!!!
        // NOT COMPLETE!  DELETE??
        constructor(surface, options) {
            this.surface = surface;
            var ssettings = surface.settings;
            this.settings = $.extend({
                threshold: ssettings.threshold,
                color_rotator: s.color_rotator,
            }, options);
            this.positions = null;
            this.normals = null;
            this.colors = null;
            this.points_mesh = null;
            this.reset();
        };
        get_points_mesh(THREE, colorize) {
            this.surface.reset_perspectives();
            this.check_voxels();
            this.points_mesh = this.surface.crossing.get_points_mesh({THREE: THREE, colorize:colorize});
            return this.points_mesh;
        };
        update_points_mesh(mesh) {
            mesh = mesh || this.points_mesh;
            this.check_voxels();
            mesh.update_sphere_locations();
        };
        get_surface_geometry (THREE, clean, normal_binning) {
            this.surface.reset_perspectives();
            this.check_surface();
            this.surface_geometry = this.surface.linked_three_geometry(THREE, clean, normal_binning);
            return this.surface_geometry;
        };
        update_surface_geometry(geometry) {
            geometry = geometry || this.surface_geometry;
            this.surface.reset_perspectives();
            this.check_surface();
            geometry.check_update_link();
        };
        set_threshold(threshold) {
            this.settings.threshold = threshold;
            this.reset();
        };
        set_color_rotator(matrix) {
            this.settings.color_rotator = matrix;
            this.reset();
        };
        reset() {
            this.voxels_ready = false;
            this.surface_ready = false;
            this.parameters_set = false;
        };
        check_parameters() {
            // lazily set parameters just before execution.
            if (!this.parameters_set) {
                // mark all (other) perspectives as invalid
                this.surface.reset_perspectives();
                this.surface.set_color_rotator(this.settings.color_rotator);
                this.surface.set_threshold(this.settings.threshold)
                this.parameters_set = true;
            }
        };
        check_voxels() {
            this.check_parameters();
            if (!this.voxels_ready) {
                this.surface.crossing.get_compacted_feedbacks();
                this.voxels_ready = true;
            }
        };
        check_surface() {
            this.check_parameters();
            if (!this.surface_ready) {
                this.surface.run();
                this.surface_ready = true;
                this.voxels_ready = true;  // surface.run automatically updates voxels too.
            }
        };
        get_positions() {
            this.check_surface();
            this.positions = this.surface.get_positions(this.positions);
            return this.positions;
        };
        get_normals() {
            this.check_surface();
            this.normals = this.surface.get_normals(this.normals);
            return this.normals;
        };
        get_colors() {
            this.check_surface();
            this.colors = this.surface.get_colors(this.colors);
            return this.colors;
        };
    };


    $.fn.webGL2surfaces3dopt = function (options) {
        return new WebGL2Surfaces3dOpt(options);
    };

    /*
    $.fn.webGL2surfaces3d = function (options) {

        // XXXX THIS IS HISTORICAL AND HAS NOT BEEN UPDATED FOR NEW CONVENTIONS XXXX

        // from grid of sample points generate iso-surfacde triangulation.
        class WebGL2Surfaces3d {
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
                    //color: [1, 1, 1],   ??? not used ???
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
                var nvoxels = s.num_rows * s.num_cols * s.num_layers * s.num_blocks;
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

                // set up input parameters
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
                    geometry.attributes.color.needsUpdate = true;
                    that.link_needs_update = false;
                }
                this.settings.after_run_callback = after_run;
                this.check_update_link = check_update_link;
                return geometry;
            };
            set_threshold(value) {
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
        
        // global contour threshold
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
        //   (triangle_num << 4) || ((fA > v) << 3 || ((fB > v) << 2 || ((fC> v) << 1 || ((fD > v)
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
        
        return new WebGL2Surfaces3d(options);
    };
    */

    $.fn.webGL2surfaces3dopt.simple_example = function (container, opt) {
        var gl = $.fn.feedWebGL2.setup_gl_for_example(container);

        //if (!opt) {
        //    throw new Error("'non optimized' surface implementation has been commented out.");
        //}

        var context = container.feedWebGL2({
            gl: gl,
        });
        var valuesArray = new Float32Array([
            0,0,0,
            0,0,0,
            0,0,0,

            1,1,1,
            1,1,1,
            1,1,1,

            1,1,1,
            1,1,1,
            1,1,1,
        ]);
        var h = 0.5
        var ddz = 0.1
        var init = container.webGL2surfaces_from_diagonals;
        if (opt) {
            init = container.webGL2surfaces3dopt;
        }
        var contours = init(
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
                //color: [h, h, h],  ??? not used ???
                rasterize: true,
                threshold: 0.3,
                // only for "optimized"
                shrink_factor: 0.8,
                // rotate the color direction using unit matrix
                color_rotator: [
                    0, 0, 1,
                    1, 0, 0,
                    0, 1, 0,
                ],
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
            contours.set_threshold(threshold);
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

    // Simplified surface interpolation using voxel diagonals.
    // This method may be better for fast high resolution renders
    // because it generates half as many triangles, but if may look worse
    // in low resolution because some triangles overlap and the interpolation
    // is not as precise. (experimental.)
    class WebGL2SurfacesFromDiagonals extends WebGL2Surfaces3dOpt {
        get_segments(compacted) {
            var s = this.settings;
            var container = $(this.feedbackContext.canvas);
            this.segments = container.webGL2DiagonalInterpolation({
                feedbackContext: this.feedbackContext,
                indices: compacted.indices,
                front_corners: compacted.front_corners,
                back_corners: compacted.back_corners,
                num_rows: s.num_rows,
                num_cols: s.num_cols,
                num_layers: s.num_layers,
                num_blocks: s.num_blocks,
                rasterize: s.rasterize,
                dx: s.dx,
                dy: s.dy,
                dz: s.dz,
                translation: s.translation,
                threshold: s.threshold,
                invalid_coordinate: s.invalid_coordinate,
                location: s.location,
                samplers: this.samplers,
                color_rotator: s.color_rotator,
            });
            // compute corner offsets for triangle generation
            var triangle_corner_offsets = [];
            var row_offset = s.num_cols;
            var layer_offset = s.num_cols * s.num_rows;
            for (var i=0; i<triangle_corners.length; i++) {
                var offsets = [];
                var corners = triangle_corners[i]
                for (var j=0; j<2; j++) {
                    var corner = corners[j];
                    var offset = corner[0] + corner[1] * row_offset + corner[2] * layer_offset;
                    offsets.push(offset);
                }
                triangle_corner_offsets.push(offsets);
            }
            this.diagonal_offset = 1 + row_offset + layer_offset;
            this.triangle_corner_offsets = triangle_corner_offsets;
            return this.segments;
        };
        run_postprocessing() {
            // generate triangles for interpolated voxels.
            this.get_triangle_indices();
            this._get_positions();
            this._get_normals();
            // this._get_colors();
            this.fix_normals();
        };
        fix_normals() {
            // reverse normal if it points opposite triangle face
            // xxx this operation could be done on the gpu if it is a bottleneck xxx
            var positions = this._triangle_positions;
            var normals = this._triangle_normals;
            for (var cursor=0; cursor<this._last_nondegenerate_position; cursor += 9) {
                // compute triangle normal
                var Px = positions[cursor];
                var Py = positions[cursor+1];
                var Pz = positions[cursor+2];
                var Qx = positions[cursor+3];
                var Qy = positions[cursor+4];
                var Qz = positions[cursor+5];
                var Rx = positions[cursor+6];
                var Ry = positions[cursor+7];
                var Rz = positions[cursor+8];
                var Ax = Px - Qx;
                var Ay = Py - Qy;
                var Az = Pz - Qz;
                var Bx = Px - Rx;
                var By = Py - Ry;
                var Bz = Pz - Rz;
                // cross product 
                var Sx = Ay * Bz - Az * By;
                var Sy = Az * Bx - Ax * Bz;
                var Sz = Ax * By - Ay * Bx;
                // reverse vertex normal when it points away from triangle normal
                for (var offset=0; offset<9; offset+=3) {
                    var index = cursor + offset;
                    var x = normals[index];
                    var y = normals[index+1];
                    var z = normals[index+2];
                    var dot = x * Sx + y * Sy + z * Sz;
                    if (dot < 0) {
                        // reverse the normal orientation
                        normals[index] = -x;
                        normals[index+1] = -y;
                        normals[index+2] = -z;
                    }
                }
            }
        };
        get_triangle_indices() {
            // determine vertex position indices for triangles for active triangles.
            // index_indicator is negative where the position index is invalid.
            var s = this.settings;
            var threshold = s.threshold;
            var values = s.valuesArray;
            // warning: index_indicator is modified in place for non-negative entries such that
            //   pi = index_indicator[voxel_index]
            //   voxel_position = [positions[pi], positions[pi+1], positions[pi+2], ]
            // this assumes index_indicator is only used as a sentinel until the next iteration.
            var index_indicator = this.crossing.full_index_indicator_array(); // make a copy...
            var indices = this.segments.get_indices();
            // maximum number of triangle vertices (3 per triangle)
            var max_length = 3 * triangle_corners.length * indices.length;
            // ravelled triangle vertex indices
            var triangle_indices = new Int32Array(max_length);
            var row_offset = s.num_cols;
            var layer_offset = s.num_cols * s.num_rows;
            var block_offset = layer_offset * s.num_layers;
            var triangle_corner_offsets = this.triangle_corner_offsets;
            var triangle_cursor = 0;
            //var diagonal_offset = this.diagonal_offset;
            for (var root_index=0; root_index<indices.length; root_index++) {
                var root = indices[root_index];
                if ((root >= 0) && (index_indicator[root] >= 0)) {
                    // point index_indicator into the indices array
                    index_indicator[root] = root_index;
                    // root is the voxel index of an interpolated crossing voxel
                    // make sure it is not on an outer boundary (wrapping around)
                    var in_row = (Math.floor((root + 1)/row_offset) == Math.floor(root/row_offset));
                    var in_layer = (Math.floor((root + row_offset)/layer_offset) == Math.floor(root/layer_offset));
                    var in_block = (Math.floor((root + layer_offset)/block_offset) == Math.floor(root/block_offset));
                    if (in_row && in_layer && in_block) {
                        // root is not on an outer boundary
                        // generate all triangles with valid corner indices
                        // var diff0 = values[root + diagonal_offset] - threshold;
                        // var invert_triangle = (diff0 < 0)
                        for (var triangle_index=0; triangle_index<triangle_corner_offsets.length; triangle_index++) {
                            var offsets = triangle_corner_offsets[triangle_index];
                            var corner_index0 = root + offsets[0];
                            var corner_index1 = root + offsets[1];
                            if ((index_indicator[corner_index0] >= 0) && (index_indicator[corner_index1] >= 0)) {
                                // valid triangle!
                                // var diff1 = values[corner_index0] - threshold;
                                // var diff2 = values[corner_index1] - threshold;
                                // var invert_triangle = ((diff0 * diff1 * diff2) < 0.0);
                                triangle_indices[triangle_cursor] = root;
                                triangle_cursor ++;
                                //if (invert_triangle) {
                                    triangle_indices[triangle_cursor] = corner_index1;
                                    triangle_cursor ++;
                                    triangle_indices[triangle_cursor] = corner_index0;
                                //} else {
                                //    triangle_indices[triangle_cursor] = corner_index0;
                                //    triangle_cursor ++;
                                //    triangle_indices[triangle_cursor] = corner_index1;
                                //}
                                triangle_cursor ++;
                            }
                        }
                    }
                }
            }
            if (triangle_cursor < max_length) {
                triangle_indices = triangle_indices.slice(0, triangle_cursor);
            }
            this.index_indicator = index_indicator;
            this.indices = indices;
            this.triangle_indices = triangle_indices;
            return triangle_indices;
        };
        _get_positions(triangle_positions) {
            this.voxel_positions = this.segments.get_positions(this.voxel_positions);
            triangle_positions = this.select_positions(this.triangle_indices, this.voxel_positions, triangle_positions);
            // xxxx debug only
            // triangle_positions = this.boxy_positions(this.triangle_indices);
            this._triangle_positions = triangle_positions;
            return triangle_positions;
        };
        get_positions(triangle_positions) {
            return this._triangle_positions;
        };
        _get_normals(triangle_normals) {
            this.voxel_normals = this.segments.get_normals(this.voxel_normals);
            triangle_normals = this.select_positions(this.triangle_indices, this.voxel_normals, triangle_normals);
            this._triangle_normals = triangle_normals;
            return triangle_normals;
        };
        get_normals(triangle_positions) {
            return this._triangle_normals;
        };
        get_colors(triangle_colors) {
            this.voxel_colors = this.segments.get_colors(this.voxel_colors);
            triangle_colors = this.select_positions(this.triangle_indices, this.voxel_colors, triangle_colors);
            this._triangle_colors = triangle_colors;
            return triangle_colors;
        };
        boxy_positions(triangle_indices) {
            // for debug/test only -- unadjusted box positions.
            var s = this.settings;
            var fill_value = -1;
            var n_indices = triangle_indices.length;
            //var index_indicator = this.index_indicator;
            var buffersize = 3 * 3 * 6 * this.indices.length;
            var triangle_positions = new Float32Array( buffersize );
            var cursor = 0;
            var row_offset = s.num_cols;
            var layer_offset = s.num_cols * s.num_rows;
            var block_offset = layer_offset * s.num_layers;
            for (var i=0; i<n_indices; i++) {
                // position index is for a xyz vector ravelled in positions array.
                var voxel_index = triangle_indices[i];
                //var vertex_index = index_indicator[voxel_index]; // translate voxel id to compact location
                var block_ravelled_index = voxel_index % block_offset;
                var layer_num = Math.floor(block_ravelled_index / layer_offset);
                var layer_ravelled_index = block_ravelled_index % layer_offset;
                var row_num = Math.floor(layer_ravelled_index / row_offset);
                var col_num = layer_ravelled_index % row_offset;
                triangle_positions[cursor] = col_num;
                cursor ++;
                triangle_positions[cursor] = row_num;
                cursor ++;
                triangle_positions[cursor] = layer_num;
                cursor ++;
            }
            // fill in the remaining positions (degenerate triangles)
            while (cursor < buffersize) {
                triangle_positions[cursor] = fill_value;
                cursor ++;
            }
            return triangle_positions;
        }
        select_positions(triangle_indices, positions, triangle_positions, fill_value) {
            fill_value = fill_value || -1;
            // assumes index_indicator now "points into" the positions array
            var index_indicator = this.index_indicator;
            var n_indices = triangle_indices.length;
            var buffersize;
            if (!triangle_positions) {
                // Always allocate 6 triangles per possible index even if they are not all used
                // because we are using BufferAttributes and they may be needed in the next iteration.
                // Three floats per three vertices per six triangles for each index.
                buffersize = 3 * 3 * 6 * this.indices.length;
                var triangle_positions = new Float32Array( buffersize );
            } else {
                buffersize = triangle_positions.length;
            }
            var cursor = 0;
            for (var i=0; i<n_indices; i++) {
                // position index is for a xyz vector ravelled in positions array.
                var voxel_index = triangle_indices[i];
                var vertex_index = index_indicator[voxel_index]; // translate voxel id to compact location
                var position_index = vertex_index * 3;  // position is ravelled xyz
                triangle_positions[cursor] = positions[position_index];
                cursor ++;
                position_index ++;
                triangle_positions[cursor] = positions[position_index];
                cursor ++;
                position_index ++;
                triangle_positions[cursor] = positions[position_index];
                cursor ++;
            }
            this._last_nondegenerate_position = cursor;
            // fill in the remaining positions (degenerate triangles)
            while (cursor < buffersize) {
                triangle_positions[cursor] = fill_value;
                cursor ++;
            }
            return triangle_positions
        };
        
        clean_positions_and_normals(normal_binning, truncate) {
            throw new Error("clean_positions_and_normals not yet implemented for diagonals");
        };
    };

    $.fn.webGL2surfaces_from_diagonals = function (options) {
        return new WebGL2SurfacesFromDiagonals(options);
    };

    var triangle_corners = [
        [[0, 1, 1],
         [0, 0, 1]],

        [[0, 1, 0],
         [0, 1, 1]],

        [[0, 0, 1],
         [1, 0, 1]],

        [[1, 0, 1],
         [1, 0, 0]],

        [[1, 1, 0],
         [0, 1, 0]],

        [[1, 0, 0],
         [1, 1, 0]],
    ];

    $.fn.webGL2surfaces_from_diagonals.example = function(container) {
        //s
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

        var contours = container.webGL2surfaces_from_diagonals(
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
                //color: [h, h, h],  ??? not used ???
                rasterize: true,
                threshold: 0.3,
                // only for "optimized"
                shrink_factor: 0.8,
                // rotate the color direction using unit matrix
                color_rotator: [
                    0, 0, 1,
                    1, 0, 0,
                    0, 1, 0,
                ],
            }
        );
        contours.run();
        var indices = contours.get_triangle_indices();
        $("<div> triangle indices </div>").appendTo(container);
        for (var i=0; i<indices.length; i++) {
            if ((i % 3) == 0) {
                $("<br/>").appendTo(container);
            }
            $("<span> " + indices[i] + "</span> ").appendTo(container);
        }
        var vertices = contours.get_positions();
        $("<div> triangle vertices </div>").appendTo(container);
        for (var i=0; i<vertices.length; i++) {
            if ((i % 9) == 0) {
                $("<br/>").appendTo(container);
            }
            $("<span> " + vertices[i].toFixed(2) + "</span> ").appendTo(container);
        }
        return contours;
    };

})(jQuery);