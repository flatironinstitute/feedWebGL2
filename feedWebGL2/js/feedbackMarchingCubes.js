
/*

JQuery plugin populating 3 dimensional contours using the Marching Cubes method.

requires feedWebGL to be loaded.

Structure follows: https://learn.jquery.com/plugins/basic-plugin-creation/

*/

// XXX At the moment some segments are copy/pasted/modified from FeedbackSurface.js.
// XXX In the future either deprecate FeedbackSurface.js or unify the shared code fragments.

"use strict";

(function($) {


    $.fn.webGL2MarchingCubes = function(options) {
        return new WebGL2MarchingCubes(options);
    };

    class  WebGL2MarchingCubes {

        constructor(options) {
            //var that = this;
            this.settings = $.extend({
                // default settings:
                shrink_factor: null, // how much to shrink buffers
                feedbackContext: null,    // the underlying FeedbackContext context to use
                valuesArray: null,   // the array buffer of values to contour
                num_rows: null,
                num_cols: null,
                num_layers: 1,  // default to "flat"
                num_blocks: 1,
                dk: [1, 0, 0],
                dj: [0, 1, 0],
                di: [0, 0, 1],
                translation: [0, 0, 0],
                //color: [1, 1, 1],   ??? not used???
                rasterize: false,
                threshold: 0,  // value at contour
                //invalid_coordinate: -100000,  // invalidity marker for positions, must be very negative
                grid_min: [0, 0, 0],
                grid_max: [-1, -1, -1],  // disabled grid coordinate filtering (invalid limits)
                //after_run_callback: null,   // call this after each run.
                // method of conversion from grid coordinates to world coordinates
                location: "std", 
                // parameters needed by location method if any.
                location_parameters: null,
            }, options);
            var s = this.settings;
            // for now don't support multiple blocks...
            if (s.num_blocks > 1) {
                throw new Error("multiple blocks not yet supported " + s.num_blocks)
            }
            this.shape = [s.num_layers, s.num_rows, s.num_cols]
            var [I, J, K] = this.shape;
            var grid_size = I * J * K;
            if (s.valuesArray.length != grid_size) {
                throw new Error("array must match declared dimensions; " + [s.valuesArray.length, grid_size])
            }
            if (!s.shrink_factor) {
                // shrink factor heuristic
                var boundary_size = 4 * (I * J + I * K + J * K + I + J + K);
                s.shrink_factor = 1.0;
                if (boundary_size < grid_size) {
                    s.shrink_factor = boundary_size * 1.0 / grid_size;
                }
            }
            // Set up fixed length data arrays:
            // voxel indexing (xxxx this could be unsigned byte...)
            //this.voxel_indices = new Int32Array(grid_size);
            // Allocate edge data structures
            this.num_edges = Math.trunc(s.shrink_factor * grid_size + 1);
            this.num_edge_triples = 3 * this.num_edges;
            this.edge_index_triples = new Int32Array(this.num_edge_triples);
            this.edge_weight_triples = new Float32Array(this.num_edge_triples);
            // Allocate triangle index data structure (xxxx same size as edges?)
            this.triangle_index_triples = new Int32Array(this.num_edge_triples);
            // edge indices: 3 directions for each voxel
            this.nedges = grid_size * 3;
            this.edge_index_to_compressed_index = new Int32Array(this.nedges);
            // set up tables for this shape
            this.assignment_offsets = this.create_templates();
            // create the voxel indexer
            this.indexer = $.fn.webGL2MarchingCubeIndexer(
                {
                    feedbackContext: s.feedbackContext,
                    valuesArray: s.valuesArray,
                    //indicesArray: this.voxel_indices,
                    num_rows: s.num_rows,
                    num_cols: s.num_cols,
                    num_layers: s.num_layers,
                    grid_min: s.grid_min,
                    grid_max: s.grid_max,
                    threshold: s.threshold,
                }
            );
            this.positioner = $.fn.webGL2MarchingCubePositioner(
                {
                    feedbackContext: s.feedbackContext,
                    num_edges: this.num_edges,
                    edge_index_triples: this.edge_index_triples,
                    // matching edge weight interpolations, ravelled
                    edge_weight_triples: this.edge_weight_triples,
                    // volume dimensions
                    num_rows: s.num_rows,
                    num_cols: s.num_cols,
                    num_layers: s.num_layers,
                    di: s.di,
                    dj: s.dj,
                    dk: s.dk,
                    translation: s.translation,
                    threshold: s.threshold,  // value at contour
                }
            );
            this.voxel_indices = null;
        };
        run() {
            var indexer = this.indexer;
            indexer.run();
            this.voxel_indices = indexer.voxel_index_array;
            this.generate_triangles();
            var positioner = this.positioner;
            positioner.run();
            this.positions = positioner.positions;
            this.normals = positioner.normals;
        };

        create_templates() {
            var [I, J, K] = this.shape;
            var [Ioffset, Joffset, Koffset] = [J*K, K, 1];
            return TRIANGLE_ASSIGNMENT_TEMPLATES.map(
                function(triangles_templates) {
                    return triangles_templates.map(
                        function (triangle_template) {
                            return triangle_template.map(
                                function (edge_template) {
                                    var [origin, dimension] = edge_template;
                                    // dot product
                                    var [di, dj, dk] = origin;
                                    var origin_offset = di * Ioffset + dj * Joffset + dk * Koffset;
                                    // shift dimension in low part of int
                                    return (3 * origin_offset) + dimension;
                                }
                            )
                        }
                    )
                }
            );
        };

        generate_triangles() {
            // input arrays
            var s = this.settings;
            var threshold = s.threshold;
            var voxel_indices = this.voxel_indices;
            var assignment_offsets = this.assignment_offsets;
            var valuesArray = s.valuesArray;
            // output arrays
            var num_triples = this.num_edge_triples;
            var edge_index_triples = this.edge_index_triples;
            var edge_weight_triples = this.edge_weight_triples;
            var triangle_index_triples = this.triangle_index_triples;
            // count of all possible edges
            var nedges = this.nedges;
            var edge_index_to_compressed_index = this.edge_index_to_compressed_index
            // helpers
            // count of max recorded edges
            var num_edges = this.num_edges;
            // store triangle number used to complete incident edges for each output edge
            var edge_number_to_triangle_number = new Int32Array(num_edges);
            // initialize all output arrays to dummy values
            for (var index=0; index<num_triples; index++) {
                edge_index_triples[index] = -1;
                edge_weight_triples[index] = -1.0;
                triangle_index_triples[index] = -1;
            }
            for (var index=0; index<num_edges; index++) {
                edge_number_to_triangle_number[index] = -1
            }
            for (var index=0; index<nedges; index++) {
                edge_index_to_compressed_index[index] = -1;
            }
            // main logic:
            var [I, J, K] = this.shape;
            var [Ioffset, Joffset, Koffset] = [J*K, K, 1];
            var [I1, J1, K1] = [I-1, J-1, K-1];
            var voxel_number = 0;
            var edge_count = 0;
            var triangle_count = 0;
            var triangle_limit = num_triples - 3;
            var too_many_triangles = false;
            // shared array for all triangles
            var triangle_edge_indices = [0, 0, 0];
            // fill 
            //   edge_index_to_compressed_index, 
            //   edge_index_triples (first column index i*3)
            //   edge_weight_triples (first column index i*3)
            //   triangle_index_triples
            for (var i=0; i<I1; i++) {
                for (var j=0; j<J1; j++) {
                    for (var k=0; k<K1; k++) {
                        var voxel_index = voxel_indices[voxel_number];
                        // for well behaved surfaces in larger volumes this test mostly fails
                        if (voxel_index > 0)
                        {
                            var edge_base_index = voxel_number * 3;
                            // Generate a triangle for each assignment template at this voxel index.
                            var triangles_edge_offsets = assignment_offsets[voxel_index];
                            for (var t_num=0; t_num<triangles_edge_offsets.length; t_num++) {
                                var triangle_edge_offset = triangles_edge_offsets[t_num];
                                var triangle_ok = true;
                                for (var v_num=0; v_num < 3; v_num++) {
                                    // determine the edge index for this vertex
                                    var edge_offset = triangle_edge_offset[v_num];
                                    var edge_index = edge_base_index + edge_offset;
                                    triangle_edge_indices[v_num] = edge_index;
                                    // initialize the edge data structures (first column) if needed
                                    if (edge_index_to_compressed_index[edge_index] < 0) {
                                        if (edge_count < num_edges) {
                                            // populate "center" entry for edge triple
                                            var first_column = 3 * edge_count;
                                            edge_index_triples[first_column] = edge_index;
                                            edge_index_to_compressed_index[edge_index] = edge_count;
                                            edge_number_to_triangle_number[edge_count] = triangle_count;
                                            // calculate center edge interpolation weight (first column)
                                            // inline for speed
                                            var dimension = edge_index % 3;
                                            // ijk is sometimes not the same as voxel number.
                                            var ijk = (edge_index / 3) | 0; //Math.floor(edge_index / 3);
                                            var k0 = ijk % K;
                                            var ij = (ijk / K) | 0;
                                            var j0 = ij % J;
                                            var i0 = (ij / J) | 0;
                                            // value at low end point
                                            var value0 = valuesArray[ijk];
                                            // value at high end point
                                            var P1 = [i0, j0, k0];
                                            P1[dimension] += 1;
                                            var P1index = (P1[0] * Ioffset) + (P1[1] * Joffset) + (P1[2] * Koffset);
                                            var value1 = valuesArray[P1index];
                                            var edge_weight = (value0 - threshold) / (value0 - value1);
                                            edge_weight_triples[first_column] = edge_weight;
                                            edge_count += 1;
                                        } else {
                                            triangle_ok = false;
                                        }
                                    }
                                }
                                too_many_triangles = (triangle_count >= triangle_limit);
                                if ((triangle_ok) && (!too_many_triangles)) {
                                    // record the triangle vertex indices
                                    for (var v_num=0; v_num < 3; v_num++) { 
                                        var triangle_index = triangle_count + v_num;
                                        var edge_index = triangle_edge_indices[v_num];
                                        var compressed_index = edge_index_to_compressed_index[edge_index];
                                        triangle_index_triples[triangle_index] = compressed_index;
                                    }
                                    triangle_count += 3;
                                }
                                if (too_many_triangles) { break; }
                            }
                        }
                        voxel_number += 1
                    }
                    if (too_many_triangles) { break; }
                    // skip end of row (wraps)
                    voxel_number += Koffset;
                }
                if (too_many_triangles) { break; }
                // skip last row (wraps)
                voxel_number += Joffset;
            }
            // Calculate incident edges and copy their weights for edge triples
            for (var edge_index=0; edge_index<edge_count; edge_index++) {
                var triangle_number = edge_number_to_triangle_number[edge_index];
                if (triangle_number >= 0) {
                    var first_column = 3 * edge_index;
                    var edge_center_number = edge_index_triples[first_column];
                    // find the rotation
                    var rotation = null;
                    for (var rotation_number=0; rotation_number<3; rotation_number++) {
                        var triangle_index = triangle_number + rotation_number;
                        if (triangle_index_triples[triangle_index] == edge_index) {
                            rotation = TRIANGLE_ROTATIONS[rotation_number];
                        }
                    }
                    // assert rotation is not null...
                    for (var column_index=1; column_index<3; column_index++) {
                        var entry_index = first_column + column_index;
                        var triangle_index = triangle_number + rotation[column_index];
                        var incident_edge_index = triangle_index_triples[triangle_index];
                        var incident_edge_first_column = 3 * incident_edge_index;
                        edge_index_triples[entry_index] = edge_index_triples[incident_edge_first_column];
                        edge_weight_triples[entry_index] = edge_weight_triples[incident_edge_first_column];
                    }
                }
            }
        };
    };

    const TRIANGLE_ROTATIONS = [
        [0, 1, 2],
        [1, 2, 0],
        [2, 0, 1],
    ]

    $.fn.webGL2MarchingCubes.example = function(container) {
        debugger;
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

        var marching = container.webGL2MarchingCubes(
            {
                feedbackContext: context,
                valuesArray: valuesArray,
                num_rows: 3,
                num_cols: 3,
                num_layers: 3,
                threshold: 0.333,
                dk: [1, 0, 0],
                dj: [0, 10, 0],
                di: [0, 0, 100],
                translation: [1000, 1000, 1000],
            }
        );
        marching.run();

        var report = function(something) {
            $("<div> " + something + " </div>").appendTo(container);
        };

        var indices = marching.voxel_indices;
        for (var i=0; i<indices.length; i++) {
            report("voxel " + i + " indexed " + indices[i]);
        }

        var edge_index_triples = marching.edge_index_triples;
        var edge_weight_triples = marching.edge_weight_triples;
        var triangle_index_triples = marching.triangle_index_triples;
        var triple_div = function(triple_array, index, test_array) {
            test_array = test_array || triples_array;
            var result = null;
            if (test_array[index] >= 0) {
                result = "<div>" + index + "::"
                for (var i=index; i<index+3; i++) {
                    result += " " + triple_array[i];
                }
                result += "</div>"
            }
            return result
        };
        var dump_triples = function (triples_array, test_array) {
            test_array = test_array || triples_array;
            for (var index=0; index<triples_array.length; index+=3) {
                var d = triple_div(triples_array, index, test_array);
                if (d) {
                    $(d).appendTo(container)
                } else {
                    break;
                }
            }
        }
        report("edge_index_tripls");
        dump_triples(edge_index_triples);
        report("edge_weight_triples");
        dump_triples(edge_weight_triples);
        report("triangle_index_triples");
        dump_triples(triangle_index_triples);
        report("Positions")
        dump_triples(marching.positions, edge_weight_triples);
        report("Normals");
        dump_triples(marching.normals, edge_weight_triples);

        report("Run completed successfully.")
    };

    $.fn.webGL2MarchingCubePositioner = function(options) {
        return new WebGL2MarchingCubePositioner(options);
    };

    class  WebGL2MarchingCubePositioner {
        constructor(options) {
            // There is a lot of similar code with WebGL2TriangulateVoxels xxxx refactor?
            this.settings = $.extend({
                feedbackContext: null,
                // triples of edge indices [center, left, right] for edges defining triangle, ravelled.
                edge_index_triples: null,
                // matching edge weight interpolations, ravelled
                edge_weight_triples: null,
                // number of edges (max)
                num_edges: -1,
                // volume dimensions
                num_rows: null,
                num_cols: null,
                num_layers: 0,
                di: [1, 0, 0],
                dj: [0, 1, 0],
                dk: [0, 0, 1],
                translation: [0, 0, 0],
                threshold: 0,  // value at contour
            }, options);
            this.initialize();
        };
        initialize() {
            var s = this.settings;
            var ctx = s.feedbackContext;
            this.program = ctx.program({
                vertex_shader: marchingCubesPositionerShader,
                fragment_shader: noop_fragment_shader,
                feedbacks: {
                    vPosition: {num_components: 3},
                    vNormal: {num_components: 3},
                },
            });

            this.edge_index_buffer = ctx.buffer();
            this.edge_index_buffer.initialize_from_array(s.edge_index_triples);
            this.edge_weight_buffer = ctx.buffer();
            this.edge_weight_buffer.initialize_from_array(s.edge_weight_triples);

            this.runner = this.program.runner({
                num_instances: 1,
                vertices_per_instance: s.num_edges,
                uniforms: {
                    // threshold value
                    threshold: {
                        vtype: "1fv",
                        default_value: [s.threshold],
                    },
                    uRowSize: {
                        vtype: "1iv",
                        default_value: [s.num_cols],
                    },
                    uColSize: {
                        vtype: "1iv",
                        default_value: [s.num_rows],
                    },
                    // number of layers -- NOT USED AT PRESENT
                    //uLayerSize: {
                    //   vtype: "1iv",
                    //    default_value: [s.num_layers],
                    //},
                    dk: {
                        vtype: "3fv",
                        default_value: s.dk,
                    },
                    dj: {
                        vtype: "3fv",
                        default_value: s.dj,
                    },
                    di: {
                        vtype: "3fv",
                        default_value: s.di,
                    },
                    translation: {
                        vtype: "3fv",
                        default_value: s.translation,
                    },
                },
                inputs: {
                    indices: {
                        per_vertex: true,
                        num_components: 3,
                        type: "int",
                        from_buffer: {
                            name: this.edge_index_buffer.name,
                        },
                    },
                    weights: {
                        per_vertex: true,
                        num_components: 3,
                        from_buffer: {
                            name: this.edge_weight_buffer.name,
                        },
                    },
                },
            });
        };
        run() {
            var s = this.settings;
            this.edge_index_buffer.copy_from_array(s.edge_index_triples);
            this.edge_weight_buffer.copy_from_array(s.edge_weight_triples);
            this.runner.install_uniforms();
            this.runner.run();
            // automatically load the indices into the output array
            this.positions = this.runner.feedback_array("vPosition", this.positions);
            this.normals = this.runner.feedback_array("vNormal", this.normals);
        }
    };

    const marchingCubesPositionerShader = `#version 300 es

    // iso-surface theshold
    uniform float threshold;

    // global length of rows
    uniform int uRowSize;

    // global number of columnss
    uniform int uColSize;

    // global number of layers (if values are in multiple blocks, else 0)
    //uniform int uLayerSize;

    // uniform offsets in kji directions for array index a[i,j,k]
    // applied after grid relative computations, compatible with triangulate_vertex_shader
    uniform vec3 dk, dj, di, translation;

    in vec3 weights;
    in ivec3 indices;

    // feedbacks out
    out vec3 vPosition, vNormal;

    vec3 interpolated_edge_position(in int edge_index, in float weight) {
        int dimension = edge_index % 3;
        int ijk = edge_index / 3;
        float k = float(ijk % uRowSize);
        int ij = ijk / uRowSize;
        float j = float(ij % uColSize);
        float i = float(ij / uColSize);
        vec3 P0 = vec3(i, j, k);
        vec3 P1 = vec3(i, j, k);
        P1[dimension] += 1.0;
        vec3 vertex = weight * P1 + (1.0 - weight) * P0;
        vec3 location = (di * vertex[0]) + (dj * vertex[1]) + (dk * vertex[2]) + translation;
        return location;
    }

    void main() {
        // defaults
        vPosition = vec3(-1.0, -1.0, -1.0);
        vNormal = vec3(-1.0, 0.0, 0.0);
        if (indices[0] >= 0) {
            vec3 center = interpolated_edge_position(indices[0], weights[0]);
            vec3 left = interpolated_edge_position(indices[1], weights[1]);
            vec3 right = interpolated_edge_position(indices[2], weights[2]);
            vec3 v_right = right - center;
            vec3 v_left = left - center;
            vec3 v_norm = cross(v_right, v_left);
            // uncomment
            vPosition = center;
            vNormal = normalize(v_norm);
        }
        // debug only
        //vPosition = weights;
        //vNormal = vec3(float(indices[0]), float(indices[1]), float(indices[2]));
    }
    `;

    $.fn.webGL2MarchingCubeIndexer = function(options) {
        return new WebGL2MarchingCubeIndexer(options);
    };

    class WebGL2MarchingCubeIndexer {

        constructor(options) {
            this.settings = $.extend({
                feedbackContext: null,    // the underlying FeedbackContext context to use
                valuesArray: null,   // the array buffer of values to contour
                // destination array for the indexes
                //indicesArray: null,
                num_rows: null,
                num_cols: null,
                num_layers: 1,  // default to "flat"
                num_blocks: 1,  // for physics simulations data may come in multiple blocks
                grid_min: [0, 0, 0],
                grid_max: [-1, -1, -1],  // disabled grid coordinate filtering (invalid limits)
                rasterize: false,
                threshold: 0,  // value at contour
            }, options);

            this.voxel_index_array = null;

            this.initialize();
        };
        initialize() {
            var s = this.settings;
            var ctx = s.feedbackContext;
            this.program = ctx.program({
                vertex_shader: marchingCubeIndexerShader,
                fragment_shader: noop_fragment_shader,
                feedbacks: {
                    voxel_index: {type: "int"},
                }
            });
            var inputs = {};
            var nvalues = s.valuesArray.length;
            // allocate and load buffer with a fresh name
            this.buffer = ctx.buffer();
            this.buffer.initialize_from_array(s.valuesArray);
            var buffername = this.buffer.name;
            var num_voxels = add_corner_offset_inputs(s, nvalues, buffername, inputs)

            this.runner = this.program.runner({
                num_instances: 1,
                vertices_per_instance: num_voxels,
                uniforms: {
                    // threshold value
                    threshold: {
                        vtype: "1fv",
                        default_value: [s.threshold],
                    },
                },
                inputs: inputs,
            });
        };
        run() {
            this.runner.install_uniforms();
            this.runner.run();
            // automatically load the indices into the output array
            this.voxel_index_array = this.runner.feedback_array("voxel_index", this.voxel_index_array);
        };
    };

    const marchingCubeIndexerShader = `#version 300 es

    // NOTE: indices for "outer border voxels are meaningless and should be ignored downstream.

    // iso-surface theshold
    uniform float threshold;

    // per voxel function values at voxel corners
    in float a000, a001, a010, a011, a100, a101, a110, a111;

    // voxel index feedback
    flat out int voxel_index;

    void main() {
        voxel_index = 0;   // default
        int i = 0;
        if (a000 > threshold) { i = i | 1; }
        if (a001 > threshold) { i = i | 2; }
        if (a010 > threshold) { i = i | 4; }
        if (a011 > threshold) { i = i | 8; }
        if (a100 > threshold) { i = i | 16; }
        if (a101 > threshold) { i = i | 32; }
        if (a110 > threshold) { i = i | 64; }
        if (a111 > threshold) { i = i | 128; }
        if (i < 255) {
            voxel_index = i;
        }
    }
    `;

    // xxx copied from FeedbackSurface.js
    const add_corner_offset_inputs = function(s, nvalues, buffername, inputs) {
        // add input parameters for voxel corners as indexed into ravelled buffer.
        // return highest index of interior voxel.
        //  indexing is [ix, iy, iz] -- z is fastest
        var z_offset = 1;
        var y_offset = s.num_cols;
        //var z_offset = s.num_cols * s.num_rows;
        var x_offset = s.num_cols * s.num_rows;
        var num_voxels = nvalues - (x_offset + y_offset + z_offset);

        var add_input = function (ix, iy, iz) {
            var name = (("a" + ix) + iy) + iz;
            var dk = [0, x_offset][ix];
            var dj = [0, y_offset][iy];
            var di = [0, z_offset][iz];
            inputs[name] = {
                per_vertex: true,
                num_components: 1,
                from_buffer: {
                    name: buffername,
                    skip_elements: dk + dj + di,
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

    const noop_fragment_shader = `#version 300 es
    #ifdef GL_ES
        precision highp float;
    #endif
    
    out vec4 color;

    void main() {
        color = vec4(1.0, 0.0, 0.0, 1.0);
    }
    `;

    const TRIANGLE_ASSIGNMENT_TEMPLATES = [
        [],
        [[[[0,0,0],2],[[0,0,0],1],[[0,0,0],0]]],
        [[[[0,0,1],0],[[0,0,1],1],[[0,0,0],2]]],
        [[[[0,0,0],1],[[0,0,0],0],[[0,0,1],1]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],0]]],
        [[[[0,0,0],1],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,1,0],2],[[0,0,0],0],[[0,0,0],2]],[[[0,0,0],0],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,0,1],0],[[0,0,1],1],[[0,0,0],2]],[[[0,0,0],1],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,0,0],0],[[0,0,1],1],[[0,1,0],2]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],0]],[[[0,0,0],0],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,1,1],0],[[0,1,0],2],[[0,0,1],1]]],
        [[[[0,1,1],0],[[0,1,0],2],[[0,0,1],1]],[[[0,0,0],2],[[0,0,0],1],[[0,0,0],0]]],
        [[[[0,0,0],2],[[0,0,1],0],[[0,1,0],2]],[[[0,1,1],0],[[0,1,0],2],[[0,0,1],0]]],
        [[[[0,0,0],1],[[0,0,1],0],[[0,1,0],2]],[[[0,0,0],1],[[0,0,0],0],[[0,0,1],0]],[[[0,1,1],0],[[0,1,0],2],[[0,0,1],0]]],
        [[[[0,1,1],0],[[0,1,0],0],[[0,0,1],1]],[[[0,0,0],1],[[0,0,1],1],[[0,1,0],0]]],
        [[[[0,0,1],1],[[0,0,0],0],[[0,0,0],2]],[[[0,0,0],0],[[0,0,1],1],[[0,1,1],0]],[[[0,1,1],0],[[0,1,0],0],[[0,0,0],0]]],
        [[[[0,1,1],0],[[0,1,0],0],[[0,0,1],0]],[[[0,0,1],0],[[0,0,0],1],[[0,0,0],2]],[[[0,0,0],1],[[0,0,1],0],[[0,1,0],0]]],
        [[[[0,0,0],0],[[0,0,1],0],[[0,1,0],0]],[[[0,1,1],0],[[0,1,0],0],[[0,0,1],0]]],
        [[[[1,0,0],1],[[1,0,0],2],[[0,0,0],0]]],
        [[[[0,0,0],2],[[0,0,0],1],[[1,0,0],2]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],1]]],
        [[[[0,0,1],0],[[0,0,1],1],[[0,0,0],2]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],0]]],
        [[[[1,0,0],2],[[0,0,1],0],[[0,0,0],1]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],1]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],1]]],
        [[[[1,0,0],1],[[1,0,0],2],[[0,0,0],0]],[[[0,0,0],1],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,0,0],2],[[0,1,0],0],[[1,0,0],1]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],2]],[[[0,0,0],2],[[0,1,0],2],[[0,1,0],0]]],
        [[[[1,0,0],1],[[1,0,0],2],[[0,0,0],0]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],2]],[[[0,0,0],1],[[0,1,0],2],[[0,1,0],0]]],
        [[[[1,0,0],1],[[1,0,0],2],[[0,1,0],0]],[[[0,0,1],0],[[0,1,0],2],[[0,1,0],0]],[[[0,0,1],0],[[0,1,0],0],[[1,0,0],2]],[[[0,1,0],2],[[0,0,1],0],[[0,0,1],1]]],
        [[[[0,1,1],0],[[0,1,0],2],[[0,0,1],1]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],0]]],
        [[[[0,1,1],0],[[0,1,0],2],[[0,0,1],1]],[[[0,0,0],2],[[0,0,0],1],[[1,0,0],2]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],1]]],
        [[[[0,0,0],2],[[0,0,1],0],[[0,1,0],2]],[[[0,1,1],0],[[0,1,0],2],[[0,0,1],0]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],0]]],
        [[[[0,0,0],1],[[0,0,1],0],[[0,1,0],2]],[[[1,0,0],2],[[0,0,1],0],[[0,0,0],1]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],1]],[[[0,1,1],0],[[0,1,0],2],[[0,0,1],0]]],
        [[[[0,1,1],0],[[0,1,0],0],[[0,0,1],1]],[[[0,0,0],1],[[0,0,1],1],[[0,1,0],0]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],0]]],
        [[[[0,1,1],0],[[0,1,0],0],[[0,0,1],1]],[[[0,0,0],2],[[0,1,0],0],[[1,0,0],1]],[[[0,0,0],2],[[0,0,1],1],[[0,1,0],0]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],2]]],
        [[[[1,0,0],1],[[1,0,0],2],[[0,1,0],0]],[[[0,0,0],0],[[0,0,0],1],[[0,0,0],2]],[[[0,1,1],0],[[0,1,0],0],[[0,0,1],0]],[[[0,0,1],0],[[0,1,0],0],[[1,0,0],2]]],
        [[[[1,0,0],1],[[1,0,0],2],[[0,1,0],0]],[[[0,0,1],0],[[0,1,0],0],[[1,0,0],2]],[[[0,1,1],0],[[0,1,0],0],[[0,0,1],0]]],
        [[[[0,0,1],0],[[1,0,0],2],[[1,0,1],1]]],
        [[[[0,0,0],2],[[0,0,0],1],[[0,0,0],0]],[[[0,0,1],0],[[1,0,0],2],[[1,0,1],1]]],
        [[[[0,0,1],1],[[1,0,0],2],[[1,0,1],1]],[[[1,0,0],2],[[0,0,1],1],[[0,0,0],2]]],
        [[[[0,0,1],1],[[1,0,0],2],[[1,0,1],1]],[[[0,0,0],1],[[0,0,0],0],[[0,0,1],1]],[[[1,0,0],2],[[0,0,1],1],[[0,0,0],0]]],
        [[[[0,0,1],0],[[1,0,0],2],[[1,0,1],1]],[[[0,0,0],1],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,0,1],0],[[1,0,0],2],[[1,0,1],1]],[[[0,1,0],2],[[0,0,0],0],[[0,0,0],2]],[[[0,0,0],0],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,0,1],1],[[1,0,0],2],[[1,0,1],1]],[[[1,0,0],2],[[0,0,1],1],[[0,0,0],2]],[[[0,0,0],1],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,0,1],1],[[1,0,0],2],[[1,0,1],1]],[[[0,0,0],0],[[0,0,1],1],[[0,1,0],2]],[[[1,0,0],2],[[0,0,1],1],[[0,0,0],0]],[[[0,0,0],0],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,1,1],0],[[0,1,0],2],[[0,0,1],1]],[[[0,0,1],0],[[1,0,0],2],[[1,0,1],1]]],
        [[[[0,1,1],0],[[0,1,0],2],[[0,0,1],1]],[[[0,0,0],2],[[0,0,0],1],[[0,0,0],0]],[[[0,0,1],0],[[1,0,0],2],[[1,0,1],1]]],
        [[[[1,0,1],1],[[0,1,1],0],[[0,0,0],2]],[[[0,0,0],2],[[1,0,0],2],[[1,0,1],1]],[[[0,1,1],0],[[0,1,0],2],[[0,0,0],2]]],
        [[[[0,1,1],0],[[1,0,0],2],[[1,0,1],1]],[[[0,1,1],0],[[0,1,0],2],[[0,0,0],0]],[[[0,0,0],1],[[0,0,0],0],[[0,1,0],2]],[[[1,0,0],2],[[0,1,1],0],[[0,0,0],0]]],
        [[[[0,1,1],0],[[0,1,0],0],[[0,0,1],1]],[[[0,0,0],1],[[0,0,1],1],[[0,1,0],0]],[[[0,0,1],0],[[1,0,0],2],[[1,0,1],1]]],
        [[[[0,0,1],1],[[0,0,0],0],[[0,0,0],2]],[[[0,0,0],0],[[0,0,1],1],[[0,1,1],0]],[[[0,0,1],0],[[1,0,0],2],[[1,0,1],1]],[[[0,1,1],0],[[0,1,0],0],[[0,0,0],0]]],
        [[[[0,1,1],0],[[0,1,0],0],[[0,0,0],1]],[[[1,0,1],1],[[0,1,1],0],[[0,0,0],2]],[[[0,1,1],0],[[0,0,0],1],[[0,0,0],2]],[[[0,0,0],2],[[1,0,0],2],[[1,0,1],1]]],
        [[[[0,1,1],0],[[1,0,0],2],[[1,0,1],1]],[[[1,0,0],2],[[0,1,1],0],[[0,0,0],0]],[[[0,1,1],0],[[0,1,0],0],[[0,0,0],0]]],
        [[[[1,0,0],1],[[0,0,1],0],[[0,0,0],0]],[[[0,0,1],0],[[1,0,0],1],[[1,0,1],1]]],
        [[[[0,0,0],1],[[1,0,0],1],[[1,0,1],1]],[[[0,0,0],2],[[0,0,0],1],[[0,0,1],0]],[[[1,0,1],1],[[0,0,1],0],[[0,0,0],1]]],
        [[[[1,0,0],1],[[0,0,1],1],[[0,0,0],0]],[[[0,0,0],2],[[0,0,0],0],[[0,0,1],1]],[[[0,0,1],1],[[1,0,0],1],[[1,0,1],1]]],
        [[[[0,0,1],1],[[1,0,0],1],[[1,0,1],1]],[[[1,0,0],1],[[0,0,1],1],[[0,0,0],1]]],
        [[[[1,0,0],1],[[0,0,1],0],[[0,0,0],0]],[[[0,0,1],0],[[1,0,0],1],[[1,0,1],1]],[[[0,0,0],1],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,0,1],0],[[0,1,0],2],[[1,0,1],1]],[[[0,1,0],2],[[0,0,1],0],[[0,0,0],2]],[[[0,1,0],2],[[0,1,0],0],[[1,0,1],1]],[[[0,1,0],0],[[1,0,0],1],[[1,0,1],1]]],
        [[[[0,0,0],0],[[0,0,0],1],[[0,0,0],2]],[[[0,0,1],1],[[0,1,0],0],[[1,0,0],1]],[[[0,0,1],1],[[1,0,0],1],[[1,0,1],1]],[[[0,0,1],1],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,0,1],1],[[0,1,0],0],[[1,0,0],1]],[[[0,0,1],1],[[1,0,0],1],[[1,0,1],1]],[[[0,0,1],1],[[0,1,0],2],[[0,1,0],0]]],
        [[[[1,0,0],1],[[0,0,1],0],[[0,0,0],0]],[[[0,1,1],0],[[0,1,0],2],[[0,0,1],1]],[[[0,0,1],0],[[1,0,0],1],[[1,0,1],1]]],
        [[[[0,1,1],0],[[0,1,0],2],[[0,0,1],1]],[[[0,0,0],1],[[1,0,0],1],[[1,0,1],1]],[[[0,0,0],2],[[0,0,0],1],[[0,0,1],0]],[[[1,0,1],1],[[0,0,1],0],[[0,0,0],1]]],
        [[[[0,1,1],0],[[1,0,0],1],[[1,0,1],1]],[[[1,0,0],1],[[0,1,0],2],[[0,0,0],0]],[[[0,0,0],2],[[0,0,0],0],[[0,1,0],2]],[[[1,0,0],1],[[0,1,1],0],[[0,1,0],2]]],
        [[[[0,1,1],0],[[0,1,0],2],[[0,0,0],1]],[[[0,0,0],1],[[1,0,0],1],[[1,0,1],1]],[[[1,0,1],1],[[0,1,1],0],[[0,0,0],1]]],
        [[[[0,0,1],1],[[0,0,0],0],[[0,0,0],1]],[[[0,0,0],0],[[0,0,1],1],[[0,0,1],0]],[[[0,1,1],0],[[1,0,0],1],[[1,0,1],1]],[[[1,0,0],1],[[0,1,1],0],[[0,1,0],0]]],
        [[[[0,1,1],0],[[1,0,0],1],[[1,0,1],1]],[[[0,0,0],2],[[0,0,1],1],[[0,0,1],0]],[[[1,0,0],1],[[0,1,1],0],[[0,1,0],0]]],
        [[[[0,1,1],0],[[1,0,0],1],[[1,0,1],1]],[[[0,0,0],0],[[0,0,0],1],[[0,0,0],2]],[[[1,0,0],1],[[0,1,1],0],[[0,1,0],0]]],
        [[[[0,1,1],0],[[1,0,0],1],[[1,0,1],1]],[[[1,0,0],1],[[0,1,1],0],[[0,1,0],0]]],
        [[[[1,1,0],2],[[1,0,0],1],[[0,1,0],0]]],
        [[[[0,0,0],2],[[0,0,0],1],[[0,0,0],0]],[[[1,1,0],2],[[1,0,0],1],[[0,1,0],0]]],
        [[[[1,1,0],2],[[1,0,0],1],[[0,1,0],0]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],2]]],
        [[[[0,0,0],1],[[0,0,0],0],[[0,0,1],1]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],0]],[[[1,1,0],2],[[1,0,0],1],[[0,1,0],0]]],
        [[[[0,0,0],1],[[0,1,0],2],[[1,0,0],1]],[[[1,1,0],2],[[1,0,0],1],[[0,1,0],2]]],
        [[[[1,1,0],2],[[1,0,0],1],[[0,1,0],2]],[[[0,0,0],0],[[0,1,0],2],[[1,0,0],1]],[[[0,1,0],2],[[0,0,0],0],[[0,0,0],2]]],
        [[[[0,0,0],1],[[0,1,0],2],[[1,0,0],1]],[[[1,1,0],2],[[1,0,0],1],[[0,1,0],2]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],2]]],
        [[[[0,0,0],0],[[0,0,1],1],[[0,1,0],2]],[[[1,1,0],2],[[1,0,0],1],[[0,1,0],2]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],0]],[[[0,0,0],0],[[0,1,0],2],[[1,0,0],1]]],
        [[[[0,1,1],0],[[0,1,0],2],[[0,0,1],1]],[[[1,1,0],2],[[1,0,0],1],[[0,1,0],0]]],
        [[[[0,1,1],0],[[0,1,0],2],[[0,0,1],1]],[[[0,0,0],2],[[0,0,0],1],[[0,0,0],0]],[[[1,1,0],2],[[1,0,0],1],[[0,1,0],0]]],
        [[[[0,0,0],2],[[0,0,1],0],[[0,1,0],2]],[[[1,1,0],2],[[1,0,0],1],[[0,1,0],0]],[[[0,1,1],0],[[0,1,0],2],[[0,0,1],0]]],
        [[[[0,0,0],1],[[0,0,1],0],[[0,1,0],2]],[[[0,0,0],1],[[0,0,0],0],[[0,0,1],0]],[[[1,1,0],2],[[1,0,0],1],[[0,1,0],0]],[[[0,1,1],0],[[0,1,0],2],[[0,0,1],0]]],
        [[[[1,1,0],2],[[1,0,0],1],[[0,0,0],1]],[[[0,0,0],1],[[0,1,1],0],[[1,1,0],2]],[[[0,0,0],1],[[0,0,1],1],[[0,1,1],0]]],
        [[[[0,0,1],1],[[0,0,0],0],[[0,0,0],2]],[[[0,0,0],0],[[0,0,1],1],[[0,1,1],0]],[[[0,0,0],0],[[0,1,1],0],[[1,0,0],1]],[[[1,1,0],2],[[1,0,0],1],[[0,1,1],0]]],
        [[[[0,1,1],0],[[0,0,0],1],[[0,0,0],2]],[[[1,1,0],2],[[1,0,0],1],[[0,0,0],1]],[[[0,0,0],1],[[0,1,1],0],[[1,1,0],2]],[[[0,0,0],2],[[0,0,1],0],[[0,1,1],0]]],
        [[[[0,0,0],0],[[0,0,1],0],[[0,1,1],0]],[[[0,0,0],0],[[0,1,1],0],[[1,0,0],1]],[[[1,1,0],2],[[1,0,0],1],[[0,1,1],0]]],
        [[[[0,0,0],0],[[0,1,0],0],[[1,0,0],2]],[[[1,1,0],2],[[1,0,0],2],[[0,1,0],0]]],
        [[[[1,1,0],2],[[1,0,0],2],[[0,0,0],2]],[[[0,0,0],2],[[0,0,0],1],[[0,1,0],0]],[[[0,0,0],2],[[0,1,0],0],[[1,1,0],2]]],
        [[[[0,0,0],0],[[0,1,0],0],[[1,0,0],2]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],2]],[[[1,1,0],2],[[1,0,0],2],[[0,1,0],0]]],
        [[[[1,1,0],2],[[1,0,0],2],[[0,1,0],0]],[[[0,0,0],1],[[0,1,0],0],[[1,0,0],2]],[[[1,0,0],2],[[0,0,1],0],[[0,0,0],1]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],1]]],
        [[[[1,1,0],2],[[1,0,0],2],[[0,1,0],2]],[[[0,1,0],2],[[0,0,0],0],[[0,0,0],1]],[[[0,0,0],0],[[0,1,0],2],[[1,0,0],2]]],
        [[[[0,0,0],2],[[0,1,0],2],[[1,0,0],2]],[[[1,1,0],2],[[1,0,0],2],[[0,1,0],2]]],
        [[[[1,1,0],2],[[1,0,0],2],[[0,1,0],2]],[[[0,0,0],0],[[0,0,0],1],[[0,0,0],2]],[[[0,0,1],0],[[0,1,0],2],[[1,0,0],2]],[[[0,1,0],2],[[0,0,1],0],[[0,0,1],1]]],
        [[[[1,1,0],2],[[1,0,0],2],[[0,1,0],2]],[[[0,0,1],0],[[0,1,0],2],[[1,0,0],2]],[[[0,1,0],2],[[0,0,1],0],[[0,0,1],1]]],
        [[[[0,1,1],0],[[0,1,0],2],[[0,0,1],1]],[[[0,0,0],0],[[0,1,0],0],[[1,0,0],2]],[[[1,1,0],2],[[1,0,0],2],[[0,1,0],0]]],
        [[[[1,1,0],2],[[1,0,0],2],[[0,0,0],2]],[[[0,1,1],0],[[0,1,0],2],[[0,0,1],1]],[[[0,0,0],2],[[0,0,0],1],[[0,1,0],0]],[[[0,0,0],2],[[0,1,0],0],[[1,1,0],2]]],
        [[[[1,1,0],2],[[1,0,0],2],[[0,1,1],0]],[[[0,0,1],0],[[0,1,1],0],[[1,0,0],2]],[[[0,0,0],2],[[0,0,0],0],[[0,1,0],2]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],0]]],
        [[[[1,1,0],2],[[1,0,0],2],[[0,1,1],0]],[[[0,0,1],0],[[0,1,1],0],[[1,0,0],2]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],1]]],
        [[[[0,0,1],1],[[0,0,0],0],[[0,0,0],1]],[[[0,0,0],0],[[0,0,1],1],[[1,0,0],2]],[[[1,1,0],2],[[1,0,0],2],[[0,1,1],0]],[[[0,0,1],1],[[0,1,1],0],[[1,0,0],2]]],
        [[[[1,1,0],2],[[1,0,0],2],[[0,0,0],2]],[[[0,0,0],2],[[0,0,1],1],[[0,1,1],0]],[[[0,0,0],2],[[0,1,1],0],[[1,1,0],2]]],
        [[[[0,0,0],0],[[0,0,0],1],[[0,0,0],2]],[[[1,1,0],2],[[1,0,0],2],[[0,1,1],0]],[[[0,0,1],0],[[0,1,1],0],[[1,0,0],2]]],
        [[[[1,1,0],2],[[1,0,0],2],[[0,1,1],0]],[[[0,0,1],0],[[0,1,1],0],[[1,0,0],2]]],
        [[[[1,1,0],2],[[1,0,0],1],[[0,1,0],0]],[[[0,0,1],0],[[1,0,0],2],[[1,0,1],1]]],
        [[[[0,0,0],2],[[0,0,0],1],[[0,0,0],0]],[[[1,1,0],2],[[1,0,0],1],[[0,1,0],0]],[[[0,0,1],0],[[1,0,0],2],[[1,0,1],1]]],
        [[[[0,0,1],1],[[1,0,0],2],[[1,0,1],1]],[[[1,0,0],2],[[0,0,1],1],[[0,0,0],2]],[[[1,1,0],2],[[1,0,0],1],[[0,1,0],0]]],
        [[[[0,0,1],1],[[1,0,0],2],[[1,0,1],1]],[[[0,0,0],1],[[0,0,0],0],[[0,0,1],1]],[[[1,0,0],2],[[0,0,1],1],[[0,0,0],0]],[[[1,1,0],2],[[1,0,0],1],[[0,1,0],0]]],
        [[[[0,0,0],1],[[0,1,0],2],[[1,0,0],1]],[[[1,1,0],2],[[1,0,0],1],[[0,1,0],2]],[[[0,0,1],0],[[1,0,0],2],[[1,0,1],1]]],
        [[[[1,1,0],2],[[1,0,0],1],[[0,1,0],2]],[[[0,0,0],0],[[0,1,0],2],[[1,0,0],1]],[[[0,1,0],2],[[0,0,0],0],[[0,0,0],2]],[[[0,0,1],0],[[1,0,0],2],[[1,0,1],1]]],
        [[[[1,1,0],2],[[1,0,1],1],[[0,1,0],2]],[[[1,0,0],2],[[0,0,0],1],[[0,0,0],2]],[[[0,0,1],1],[[0,1,0],2],[[1,0,1],1]],[[[0,0,0],1],[[1,0,0],2],[[1,0,0],1]]],
        [[[[1,1,0],2],[[1,0,1],1],[[0,1,0],2]],[[[0,0,1],1],[[0,1,0],2],[[1,0,1],1]],[[[0,0,0],0],[[1,0,0],2],[[1,0,0],1]]],
        [[[[0,1,1],0],[[0,1,0],2],[[0,0,1],1]],[[[1,1,0],2],[[1,0,0],1],[[0,1,0],0]],[[[0,0,1],0],[[1,0,0],2],[[1,0,1],1]]],
        [[[[0,1,1],0],[[0,1,0],2],[[0,0,1],1]],[[[0,0,0],2],[[0,0,0],1],[[0,0,0],0]],[[[1,1,0],2],[[1,0,0],1],[[0,1,0],0]],[[[0,0,1],0],[[1,0,0],2],[[1,0,1],1]]],
        [[[[1,1,0],2],[[1,0,1],1],[[0,1,1],0]],[[[1,0,0],1],[[0,1,0],0],[[0,0,0],2]],[[[0,0,0],2],[[1,0,0],2],[[1,0,0],1]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],2]]],
        [[[[0,0,0],0],[[1,0,0],2],[[1,0,0],1]],[[[1,1,0],2],[[1,0,1],1],[[0,1,1],0]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],1]]],
        [[[[0,0,0],1],[[0,0,1],0],[[1,0,0],2]],[[[1,1,0],2],[[1,0,1],1],[[0,1,1],0]],[[[0,0,0],1],[[1,0,0],2],[[1,0,0],1]],[[[0,0,0],1],[[0,0,1],1],[[0,0,1],0]]],
        [[[[1,1,0],2],[[1,0,1],1],[[0,1,1],0]],[[[0,0,0],2],[[0,0,1],1],[[0,0,1],0]],[[[0,0,0],0],[[1,0,0],2],[[1,0,0],1]]],
        [[[[1,0,0],2],[[0,0,0],1],[[0,0,0],2]],[[[1,1,0],2],[[1,0,1],1],[[0,1,1],0]],[[[0,0,0],1],[[1,0,0],2],[[1,0,0],1]]],
        [[[[1,1,0],2],[[1,0,1],1],[[0,1,1],0]],[[[0,0,0],0],[[1,0,0],2],[[1,0,0],1]]],
        [[[[1,1,0],2],[[1,0,1],1],[[0,1,0],0]],[[[0,1,0],0],[[0,0,1],0],[[0,0,0],0]],[[[0,0,1],0],[[0,1,0],0],[[1,0,1],1]]],
        [[[[1,1,0],2],[[1,0,1],1],[[0,1,0],0]],[[[0,0,1],0],[[0,1,0],0],[[1,0,1],1]],[[[0,0,0],2],[[0,0,0],1],[[0,0,1],0]],[[[0,1,0],0],[[0,0,1],0],[[0,0,0],1]]],
        [[[[0,0,1],1],[[0,1,0],0],[[1,1,0],2]],[[[1,1,0],2],[[1,0,1],1],[[0,0,1],1]],[[[0,0,0],2],[[0,0,0],0],[[0,1,0],0]],[[[0,1,0],0],[[0,0,1],1],[[0,0,0],2]]],
        [[[[0,0,1],1],[[0,1,0],0],[[1,1,0],2]],[[[0,1,0],0],[[0,0,1],1],[[0,0,0],1]],[[[1,1,0],2],[[1,0,1],1],[[0,0,1],1]]],
        [[[[0,1,0],2],[[0,0,1],0],[[0,0,0],1]],[[[0,0,1],0],[[0,0,0],0],[[0,0,0],1]],[[[0,0,1],0],[[0,1,0],2],[[1,0,1],1]],[[[1,1,0],2],[[1,0,1],1],[[0,1,0],2]]],
        [[[[0,0,1],0],[[0,1,0],2],[[1,0,1],1]],[[[1,1,0],2],[[1,0,1],1],[[0,1,0],2]],[[[0,1,0],2],[[0,0,1],0],[[0,0,0],2]]],
        [[[[1,1,0],2],[[1,0,1],1],[[0,1,0],2]],[[[0,0,0],0],[[0,0,0],1],[[0,0,0],2]],[[[0,0,1],1],[[0,1,0],2],[[1,0,1],1]]],
        [[[[1,1,0],2],[[1,0,1],1],[[0,1,0],2]],[[[0,0,1],1],[[0,1,0],2],[[1,0,1],1]]],
        [[[[0,1,0],2],[[0,0,1],1],[[0,0,0],0]],[[[0,0,0],0],[[0,0,1],1],[[0,0,1],0]],[[[1,1,0],2],[[1,0,1],1],[[0,1,1],0]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],0]]],
        [[[[1,1,0],2],[[1,0,1],1],[[0,1,1],0]],[[[0,0,0],2],[[0,0,1],1],[[0,0,1],0]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],1]]],
        [[[[1,1,0],2],[[1,0,1],1],[[0,1,1],0]],[[[0,0,0],2],[[0,0,0],0],[[0,1,0],2]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],0]]],
        [[[[1,1,0],2],[[1,0,1],1],[[0,1,1],0]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],1]]],
        [[[[0,0,1],1],[[0,0,0],0],[[0,0,0],1]],[[[0,0,0],0],[[0,0,1],1],[[0,0,1],0]],[[[1,1,0],2],[[1,0,1],1],[[0,1,1],0]]],
        [[[[1,1,0],2],[[1,0,1],1],[[0,1,1],0]],[[[0,0,0],2],[[0,0,1],1],[[0,0,1],0]]],
        [[[[0,0,0],0],[[0,0,0],1],[[0,0,0],2]],[[[1,1,0],2],[[1,0,1],1],[[0,1,1],0]]],
        [[[[1,1,0],2],[[1,0,1],1],[[0,1,1],0]]],
        [[[[0,1,1],0],[[1,0,1],1],[[1,1,0],2]]],
        [[[[0,0,0],2],[[0,0,0],1],[[0,0,0],0]],[[[0,1,1],0],[[1,0,1],1],[[1,1,0],2]]],
        [[[[0,1,1],0],[[1,0,1],1],[[1,1,0],2]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],2]]],
        [[[[0,0,0],1],[[0,0,0],0],[[0,0,1],1]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],0]],[[[0,1,1],0],[[1,0,1],1],[[1,1,0],2]]],
        [[[[0,1,1],0],[[1,0,1],1],[[1,1,0],2]],[[[0,0,0],1],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,1,1],0],[[1,0,1],1],[[1,1,0],2]],[[[0,1,0],2],[[0,0,0],0],[[0,0,0],2]],[[[0,0,0],0],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,1,1],0],[[1,0,1],1],[[1,1,0],2]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],2]],[[[0,0,0],1],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,0,0],0],[[0,0,1],1],[[0,1,0],2]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],0]],[[[0,1,1],0],[[1,0,1],1],[[1,1,0],2]],[[[0,0,0],0],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,1,0],2],[[1,0,1],1],[[1,1,0],2]],[[[1,0,1],1],[[0,1,0],2],[[0,0,1],1]]],
        [[[[0,1,0],2],[[1,0,1],1],[[1,1,0],2]],[[[0,0,0],2],[[0,0,0],1],[[0,0,0],0]],[[[1,0,1],1],[[0,1,0],2],[[0,0,1],1]]],
        [[[[1,0,1],1],[[0,1,0],2],[[0,0,1],0]],[[[0,1,0],2],[[1,0,1],1],[[1,1,0],2]],[[[0,0,0],2],[[0,0,1],0],[[0,1,0],2]]],
        [[[[0,0,0],1],[[0,0,1],0],[[0,1,0],2]],[[[0,0,0],1],[[0,0,0],0],[[0,0,1],0]],[[[1,0,1],1],[[0,1,0],2],[[0,0,1],0]],[[[0,1,0],2],[[1,0,1],1],[[1,1,0],2]]],
        [[[[1,1,0],2],[[0,1,0],0],[[0,0,1],1]],[[[0,0,0],1],[[0,0,1],1],[[0,1,0],0]],[[[0,0,1],1],[[1,0,1],1],[[1,1,0],2]]],
        [[[[1,1,0],2],[[0,1,0],0],[[0,0,1],1]],[[[0,0,1],1],[[1,0,1],1],[[1,1,0],2]],[[[0,1,0],0],[[0,0,0],0],[[0,0,0],2]],[[[0,0,0],2],[[0,0,1],1],[[0,1,0],0]]],
        [[[[0,1,0],0],[[1,0,1],1],[[1,1,0],2]],[[[1,0,1],1],[[0,1,0],0],[[0,0,1],0]],[[[0,0,1],0],[[0,0,0],1],[[0,0,0],2]],[[[0,0,0],1],[[0,0,1],0],[[0,1,0],0]]],
        [[[[0,1,0],0],[[1,0,1],1],[[1,1,0],2]],[[[0,0,0],0],[[0,0,1],0],[[0,1,0],0]],[[[1,0,1],1],[[0,1,0],0],[[0,0,1],0]]],
        [[[[0,1,1],0],[[1,0,1],1],[[1,1,0],2]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],0]]],
        [[[[0,0,0],2],[[0,0,0],1],[[1,0,0],2]],[[[0,1,1],0],[[1,0,1],1],[[1,1,0],2]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],1]]],
        [[[[0,1,1],0],[[1,0,1],1],[[1,1,0],2]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],2]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],0]]],
        [[[[1,0,0],2],[[0,0,1],0],[[0,0,0],1]],[[[0,1,1],0],[[1,0,1],1],[[1,1,0],2]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],1]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],1]]],
        [[[[1,0,0],1],[[1,0,0],2],[[0,0,0],0]],[[[0,1,1],0],[[1,0,1],1],[[1,1,0],2]],[[[0,0,0],1],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,1,1],0],[[1,0,1],1],[[1,1,0],2]],[[[0,0,0],2],[[0,1,0],0],[[1,0,0],1]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],2]],[[[0,0,0],2],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,0,1],1],[[0,1,0],2],[[0,1,1],0]],[[[0,0,0],0],[[0,0,0],1],[[0,0,0],2]],[[[0,1,0],0],[[1,0,0],1],[[1,1,0],2]],[[[1,0,1],1],[[1,0,0],2],[[0,0,1],0]]],
        [[[[0,0,1],1],[[0,1,0],2],[[0,1,1],0]],[[[0,1,0],0],[[1,0,0],1],[[1,1,0],2]],[[[1,0,1],1],[[1,0,0],2],[[0,0,1],0]]],
        [[[[0,1,0],2],[[1,0,1],1],[[1,1,0],2]],[[[1,0,1],1],[[0,1,0],2],[[0,0,1],1]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],0]]],
        [[[[0,1,0],2],[[1,0,1],1],[[1,1,0],2]],[[[0,0,0],2],[[0,0,0],1],[[1,0,0],2]],[[[1,0,1],1],[[0,1,0],2],[[0,0,1],1]],[[[1,0,0],1],[[1,0,0],2],[[0,0,0],1]]],
        [[[[0,1,0],2],[[1,0,0],1],[[1,1,0],2]],[[[1,0,0],1],[[0,1,0],2],[[0,0,0],0]],[[[0,0,0],2],[[0,0,0],0],[[0,1,0],2]],[[[1,0,1],1],[[1,0,0],2],[[0,0,1],0]]],
        [[[[1,0,0],1],[[0,1,0],2],[[0,0,0],1]],[[[0,1,0],2],[[1,0,0],1],[[1,1,0],2]],[[[1,0,1],1],[[1,0,0],2],[[0,0,1],0]]],
        [[[[1,0,1],1],[[1,0,0],2],[[0,0,1],1]],[[[0,0,1],1],[[0,0,0],0],[[0,0,0],1]],[[[0,0,0],0],[[0,0,1],1],[[1,0,0],2]],[[[0,1,0],0],[[1,0,0],1],[[1,1,0],2]]],
        [[[[1,0,1],1],[[1,0,0],2],[[0,0,1],1]],[[[0,0,0],2],[[0,0,1],1],[[1,0,0],2]],[[[0,1,0],0],[[1,0,0],1],[[1,1,0],2]]],
        [[[[0,0,0],0],[[0,0,0],1],[[0,0,0],2]],[[[0,1,0],0],[[1,0,0],1],[[1,1,0],2]],[[[1,0,1],1],[[1,0,0],2],[[0,0,1],0]]],
        [[[[0,1,0],0],[[1,0,0],1],[[1,1,0],2]],[[[1,0,1],1],[[1,0,0],2],[[0,0,1],0]]],
        [[[[0,1,1],0],[[1,0,0],2],[[1,1,0],2]],[[[1,0,0],2],[[0,1,1],0],[[0,0,1],0]]],
        [[[[0,0,0],2],[[0,0,0],1],[[0,0,0],0]],[[[0,1,1],0],[[1,0,0],2],[[1,1,0],2]],[[[1,0,0],2],[[0,1,1],0],[[0,0,1],0]]],
        [[[[0,0,0],2],[[1,0,0],2],[[1,1,0],2]],[[[0,1,1],0],[[0,0,1],1],[[0,0,0],2]],[[[1,1,0],2],[[0,1,1],0],[[0,0,0],2]]],
        [[[[0,0,0],1],[[0,0,0],0],[[0,0,1],1]],[[[1,0,0],2],[[0,0,1],1],[[0,0,0],0]],[[[0,1,1],0],[[1,0,0],2],[[1,1,0],2]],[[[1,0,0],2],[[0,1,1],0],[[0,0,1],1]]],
        [[[[0,1,1],0],[[1,0,0],2],[[1,1,0],2]],[[[1,0,0],2],[[0,1,1],0],[[0,0,1],0]],[[[0,0,0],1],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,1,1],0],[[1,0,0],2],[[1,1,0],2]],[[[1,0,0],2],[[0,1,1],0],[[0,0,1],0]],[[[0,1,0],2],[[0,0,0],0],[[0,0,0],2]],[[[0,0,0],0],[[0,1,0],2],[[0,1,0],0]]],
        [[[[0,0,0],2],[[1,0,0],2],[[1,1,0],2]],[[[0,0,1],1],[[0,1,0],2],[[0,1,1],0]],[[[0,1,0],0],[[0,0,0],1],[[0,0,0],2]],[[[1,1,0],2],[[0,1,0],0],[[0,0,0],2]]],
        [[[[0,0,1],1],[[0,1,0],2],[[0,1,1],0]],[[[1,0,0],2],[[0,1,0],0],[[0,0,0],0]],[[[0,1,0],0],[[1,0,0],2],[[1,1,0],2]]],
        [[[[0,1,0],2],[[1,0,0],2],[[1,1,0],2]],[[[1,0,0],2],[[0,1,0],2],[[0,0,1],0]],[[[0,0,1],1],[[0,0,1],0],[[0,1,0],2]]],
        [[[[0,1,0],2],[[1,0,0],2],[[1,1,0],2]],[[[0,0,0],2],[[0,0,0],1],[[0,0,0],0]],[[[1,0,0],2],[[0,1,0],2],[[0,0,1],0]],[[[0,0,1],1],[[0,0,1],0],[[0,1,0],2]]],
        [[[[1,0,0],2],[[0,1,0],2],[[0,0,0],2]],[[[0,1,0],2],[[1,0,0],2],[[1,1,0],2]]],
        [[[[0,1,0],2],[[1,0,0],2],[[1,1,0],2]],[[[0,0,0],1],[[0,0,0],0],[[0,1,0],2]],[[[1,0,0],2],[[0,1,0],2],[[0,0,0],0]]],
        [[[[0,1,0],0],[[1,0,0],2],[[1,1,0],2]],[[[1,0,0],2],[[0,1,0],0],[[0,0,0],1]],[[[0,0,0],1],[[0,0,1],0],[[1,0,0],2]],[[[0,0,0],1],[[0,0,1],1],[[0,0,1],0]]],
        [[[[1,0,0],2],[[0,1,0],0],[[0,0,0],0]],[[[0,0,0],2],[[0,0,1],1],[[0,0,1],0]],[[[0,1,0],0],[[1,0,0],2],[[1,1,0],2]]],
        [[[[0,0,0],2],[[1,0,0],2],[[1,1,0],2]],[[[0,1,0],0],[[0,0,0],1],[[0,0,0],2]],[[[1,1,0],2],[[0,1,0],0],[[0,0,0],2]]],
        [[[[1,0,0],2],[[0,1,0],0],[[0,0,0],0]],[[[0,1,0],0],[[1,0,0],2],[[1,1,0],2]]],
        [[[[0,1,1],0],[[0,0,1],0],[[0,0,0],0]],[[[1,0,0],1],[[0,1,1],0],[[0,0,0],0]],[[[0,1,1],0],[[1,0,0],1],[[1,1,0],2]]],
        [[[[0,0,0],2],[[0,0,0],1],[[0,1,1],0]],[[[0,0,0],1],[[1,0,0],1],[[1,1,0],2]],[[[1,1,0],2],[[0,1,1],0],[[0,0,0],1]],[[[0,1,1],0],[[0,0,1],0],[[0,0,0],2]]],
        [[[[0,0,0],2],[[0,0,0],0],[[0,0,1],1]],[[[0,1,1],0],[[0,0,1],1],[[0,0,0],0]],[[[1,0,0],1],[[0,1,1],0],[[0,0,0],0]],[[[0,1,1],0],[[1,0,0],1],[[1,1,0],2]]],
        [[[[0,0,0],1],[[1,0,0],1],[[1,1,0],2]],[[[1,1,0],2],[[0,1,1],0],[[0,0,0],1]],[[[0,1,1],0],[[0,0,1],1],[[0,0,0],1]]],
        [[[[0,1,0],2],[[0,0,1],0],[[0,0,0],1]],[[[0,0,1],0],[[0,0,0],0],[[0,0,0],1]],[[[0,1,0],0],[[1,0,0],1],[[1,1,0],2]],[[[0,0,1],0],[[0,1,0],2],[[0,1,1],0]]],
        [[[[0,1,0],2],[[0,0,1],0],[[0,0,0],2]],[[[0,1,0],0],[[1,0,0],1],[[1,1,0],2]],[[[0,0,1],0],[[0,1,0],2],[[0,1,1],0]]],
        [[[[0,0,1],1],[[0,1,0],2],[[0,1,1],0]],[[[0,0,0],0],[[0,0,0],1],[[0,0,0],2]],[[[0,1,0],0],[[1,0,0],1],[[1,1,0],2]]],
        [[[[0,0,1],1],[[0,1,0],2],[[0,1,1],0]],[[[0,1,0],0],[[1,0,0],1],[[1,1,0],2]]],
        [[[[0,1,0],2],[[0,0,1],1],[[0,0,0],0]],[[[0,1,0],2],[[1,0,0],1],[[1,1,0],2]],[[[0,0,0],0],[[0,0,1],1],[[0,0,1],0]],[[[1,0,0],1],[[0,1,0],2],[[0,0,0],0]]],
        [[[[1,0,0],1],[[0,1,0],2],[[0,0,0],1]],[[[0,1,0],2],[[1,0,0],1],[[1,1,0],2]],[[[0,0,0],2],[[0,0,1],1],[[0,0,1],0]]],
        [[[[0,1,0],2],[[1,0,0],1],[[1,1,0],2]],[[[1,0,0],1],[[0,1,0],2],[[0,0,0],0]],[[[0,0,0],2],[[0,0,0],0],[[0,1,0],2]]],
        [[[[1,0,0],1],[[0,1,0],2],[[0,0,0],1]],[[[0,1,0],2],[[1,0,0],1],[[1,1,0],2]]],
        [[[[0,0,1],1],[[0,0,0],0],[[0,0,0],1]],[[[0,0,0],0],[[0,0,1],1],[[0,0,1],0]],[[[0,1,0],0],[[1,0,0],1],[[1,1,0],2]]],
        [[[[0,1,0],0],[[1,0,0],1],[[1,1,0],2]],[[[0,0,0],2],[[0,0,1],1],[[0,0,1],0]]],
        [[[[0,0,0],0],[[0,0,0],1],[[0,0,0],2]],[[[0,1,0],0],[[1,0,0],1],[[1,1,0],2]]],
        [[[[0,1,0],0],[[1,0,0],1],[[1,1,0],2]]],
        [[[[1,0,1],1],[[1,0,0],1],[[0,1,1],0]],[[[0,1,0],0],[[0,1,1],0],[[1,0,0],1]]],
        [[[[1,0,1],1],[[1,0,0],1],[[0,1,1],0]],[[[0,0,0],2],[[0,0,0],1],[[0,0,0],0]],[[[0,1,0],0],[[0,1,1],0],[[1,0,0],1]]],
        [[[[1,0,1],1],[[1,0,0],1],[[0,1,1],0]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],2]],[[[0,1,0],0],[[0,1,1],0],[[1,0,0],1]]],
        [[[[0,0,0],1],[[0,0,0],0],[[0,0,1],1]],[[[0,0,1],0],[[0,0,1],1],[[0,0,0],0]],[[[1,0,1],1],[[1,0,0],1],[[0,1,1],0]],[[[0,1,0],0],[[0,1,1],0],[[1,0,0],1]]],
        [[[[0,0,0],1],[[0,1,0],2],[[0,1,1],0]],[[[1,0,1],1],[[1,0,0],1],[[0,0,0],1]],[[[0,0,0],1],[[0,1,1],0],[[1,0,1],1]]],
        [[[[1,0,1],1],[[1,0,0],1],[[0,1,1],0]],[[[0,0,0],0],[[0,1,0],2],[[1,0,0],1]],[[[0,1,0],2],[[0,0,0],0],[[0,0,0],2]],[[[0,1,0],2],[[0,1,1],0],[[1,0,0],1]]],
        [[[[0,0,1],1],[[0,1,0],2],[[0,1,1],0]],[[[1,0,1],1],[[1,0,0],1],[[0,0,0],1]],[[[0,0,1],0],[[0,0,0],1],[[0,0,0],2]],[[[0,0,0],1],[[0,0,1],0],[[1,0,1],1]]],
        [[[[0,0,0],0],[[0,0,1],0],[[1,0,0],1]],[[[0,0,1],1],[[0,1,0],2],[[0,1,1],0]],[[[1,0,1],1],[[1,0,0],1],[[0,0,1],0]]],
        [[[[1,0,0],1],[[0,1,0],0],[[0,0,1],1]],[[[1,0,1],1],[[1,0,0],1],[[0,0,1],1]],[[[0,1,0],0],[[0,1,0],2],[[0,0,1],1]]],
        [[[[0,0,0],2],[[0,0,0],1],[[0,0,0],0]],[[[1,0,0],1],[[0,1,0],0],[[0,0,1],1]],[[[1,0,1],1],[[1,0,0],1],[[0,0,1],1]],[[[0,1,0],0],[[0,1,0],2],[[0,0,1],1]]],
        [[[[1,0,1],1],[[0,1,0],2],[[0,0,1],0]],[[[0,0,0],2],[[0,0,1],0],[[0,1,0],2]],[[[1,0,1],1],[[0,1,0],0],[[0,1,0],2]],[[[1,0,1],1],[[1,0,0],1],[[0,1,0],0]]],
        [[[[0,0,0],0],[[0,0,1],0],[[1,0,0],1]],[[[1,0,1],1],[[1,0,0],1],[[0,0,1],0]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],1]]],
        [[[[1,0,1],1],[[1,0,0],1],[[0,0,1],1]],[[[0,0,0],1],[[0,0,1],1],[[1,0,0],1]]],
        [[[[0,0,0],0],[[0,0,1],1],[[1,0,0],1]],[[[0,0,1],1],[[0,0,0],0],[[0,0,0],2]],[[[1,0,1],1],[[1,0,0],1],[[0,0,1],1]]],
        [[[[1,0,1],1],[[1,0,0],1],[[0,0,0],1]],[[[0,0,1],0],[[0,0,0],1],[[0,0,0],2]],[[[0,0,0],1],[[0,0,1],0],[[1,0,1],1]]],
        [[[[0,0,0],0],[[0,0,1],0],[[1,0,0],1]],[[[1,0,1],1],[[1,0,0],1],[[0,0,1],0]]],
        [[[[1,0,1],1],[[1,0,0],2],[[0,1,1],0]],[[[0,0,0],0],[[0,1,1],0],[[1,0,0],2]],[[[0,0,0],0],[[0,1,0],0],[[0,1,1],0]]],
        [[[[0,0,0],1],[[0,1,0],0],[[0,1,1],0]],[[[0,0,0],2],[[0,1,1],0],[[1,0,1],1]],[[[0,0,0],2],[[0,0,0],1],[[0,1,1],0]],[[[1,0,1],1],[[1,0,0],2],[[0,0,0],2]]],
        [[[[0,0,0],2],[[0,0,0],0],[[0,0,1],1]],[[[0,1,1],0],[[0,0,1],1],[[0,0,0],0]],[[[1,0,1],1],[[1,0,0],2],[[0,0,1],0]],[[[0,0,0],0],[[0,1,0],0],[[0,1,1],0]]],
        [[[[0,0,1],1],[[0,1,0],0],[[0,1,1],0]],[[[0,1,0],0],[[0,0,1],1],[[0,0,0],1]],[[[1,0,1],1],[[1,0,0],2],[[0,0,1],0]]],
        [[[[1,0,1],1],[[1,0,0],2],[[0,1,1],0]],[[[0,0,0],0],[[0,1,0],2],[[0,1,1],0]],[[[0,1,0],2],[[0,0,0],0],[[0,0,0],1]],[[[0,0,0],0],[[0,1,1],0],[[1,0,0],2]]],
        [[[[0,0,0],2],[[0,1,1],0],[[1,0,1],1]],[[[1,0,1],1],[[1,0,0],2],[[0,0,0],2]],[[[0,0,0],2],[[0,1,0],2],[[0,1,1],0]]],
        [[[[0,0,1],1],[[0,1,0],2],[[0,1,1],0]],[[[0,0,0],0],[[0,0,0],1],[[0,0,0],2]],[[[1,0,1],1],[[1,0,0],2],[[0,0,1],0]]],
        [[[[0,0,1],1],[[0,1,0],2],[[0,1,1],0]],[[[1,0,1],1],[[1,0,0],2],[[0,0,1],0]]],
        [[[[1,0,1],1],[[1,0,0],2],[[0,0,1],1]],[[[0,1,0],2],[[0,0,1],1],[[0,0,0],0]],[[[0,0,0],0],[[0,0,1],1],[[1,0,0],2]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],0]]],
        [[[[1,0,1],1],[[1,0,0],2],[[0,0,1],1]],[[[0,0,0],2],[[0,0,1],1],[[1,0,0],2]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],1]]],
        [[[[1,0,1],1],[[1,0,0],2],[[0,0,1],0]],[[[0,0,0],2],[[0,0,0],0],[[0,1,0],2]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],0]]],
        [[[[1,0,1],1],[[1,0,0],2],[[0,0,1],0]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],1]]],
        [[[[1,0,1],1],[[1,0,0],2],[[0,0,1],1]],[[[0,0,1],1],[[0,0,0],0],[[0,0,0],1]],[[[0,0,0],0],[[0,0,1],1],[[1,0,0],2]]],
        [[[[1,0,1],1],[[1,0,0],2],[[0,0,1],1]],[[[0,0,0],2],[[0,0,1],1],[[1,0,0],2]]],
        [[[[0,0,0],0],[[0,0,0],1],[[0,0,0],2]],[[[1,0,1],1],[[1,0,0],2],[[0,0,1],0]]],
        [[[[1,0,1],1],[[1,0,0],2],[[0,0,1],0]]],
        [[[[0,1,0],0],[[1,0,0],2],[[1,0,0],1]],[[[1,0,0],2],[[0,1,0],0],[[0,0,1],0]],[[[0,0,1],0],[[0,1,0],0],[[0,1,1],0]]],
        [[[[0,1,0],0],[[1,0,0],2],[[1,0,0],1]],[[[0,0,0],2],[[0,0,0],1],[[0,0,0],0]],[[[0,0,1],0],[[0,1,0],0],[[0,1,1],0]],[[[1,0,0],2],[[0,1,0],0],[[0,0,1],0]]],
        [[[[0,0,1],1],[[0,1,0],0],[[0,1,1],0]],[[[1,0,0],1],[[0,1,0],0],[[0,0,0],2]],[[[0,1,0],0],[[0,0,1],1],[[0,0,0],2]],[[[0,0,0],2],[[1,0,0],2],[[1,0,0],1]]],
        [[[[0,0,1],1],[[0,1,0],0],[[0,1,1],0]],[[[0,1,0],0],[[0,0,1],1],[[0,0,0],1]],[[[0,0,0],0],[[1,0,0],2],[[1,0,0],1]]],
        [[[[0,1,0],2],[[0,0,1],0],[[0,0,0],1]],[[[0,0,0],1],[[0,0,1],0],[[1,0,0],2]],[[[0,0,0],1],[[1,0,0],2],[[1,0,0],1]],[[[0,0,1],0],[[0,1,0],2],[[0,1,1],0]]],
        [[[[0,1,0],2],[[0,0,1],0],[[0,0,0],2]],[[[0,0,1],0],[[0,1,0],2],[[0,1,1],0]],[[[0,0,0],0],[[1,0,0],2],[[1,0,0],1]]],
        [[[[0,0,1],1],[[0,1,0],2],[[0,1,1],0]],[[[1,0,0],2],[[0,0,0],1],[[0,0,0],2]],[[[0,0,0],1],[[1,0,0],2],[[1,0,0],1]]],
        [[[[0,0,1],1],[[0,1,0],2],[[0,1,1],0]],[[[0,0,0],0],[[1,0,0],2],[[1,0,0],1]]],
        [[[[0,1,0],0],[[1,0,0],2],[[1,0,0],1]],[[[0,1,0],0],[[0,1,0],2],[[0,0,1],0]],[[[1,0,0],2],[[0,1,0],0],[[0,0,1],0]],[[[0,0,1],1],[[0,0,1],0],[[0,1,0],2]]],
        [[[[0,0,0],0],[[1,0,0],2],[[1,0,0],1]],[[[0,0,0],2],[[0,0,1],1],[[0,0,1],0]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],1]]],
        [[[[1,0,0],1],[[0,1,0],0],[[0,0,0],2]],[[[0,0,0],2],[[1,0,0],2],[[1,0,0],1]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],2]]],
        [[[[0,0,0],0],[[1,0,0],2],[[1,0,0],1]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],1]]],
        [[[[0,0,0],1],[[0,0,1],0],[[1,0,0],2]],[[[0,0,0],1],[[1,0,0],2],[[1,0,0],1]],[[[0,0,0],1],[[0,0,1],1],[[0,0,1],0]]],
        [[[[0,0,0],2],[[0,0,1],1],[[0,0,1],0]],[[[0,0,0],0],[[1,0,0],2],[[1,0,0],1]]],
        [[[[1,0,0],2],[[0,0,0],1],[[0,0,0],2]],[[[0,0,0],1],[[1,0,0],2],[[1,0,0],1]]],
        [[[[0,0,0],0],[[1,0,0],2],[[1,0,0],1]]],
        [[[[0,1,0],0],[[0,0,1],0],[[0,0,0],0]],[[[0,0,1],0],[[0,1,0],0],[[0,1,1],0]]],
        [[[[0,0,1],0],[[0,1,0],0],[[0,1,1],0]],[[[0,0,0],2],[[0,0,0],1],[[0,0,1],0]],[[[0,1,0],0],[[0,0,1],0],[[0,0,0],1]]],
        [[[[0,0,0],2],[[0,0,0],0],[[0,0,1],1]],[[[0,1,1],0],[[0,0,1],1],[[0,0,0],0]],[[[0,0,0],0],[[0,1,0],0],[[0,1,1],0]]],
        [[[[0,0,1],1],[[0,1,0],0],[[0,1,1],0]],[[[0,1,0],0],[[0,0,1],1],[[0,0,0],1]]],
        [[[[0,1,0],2],[[0,0,1],0],[[0,0,0],1]],[[[0,0,1],0],[[0,0,0],0],[[0,0,0],1]],[[[0,0,1],0],[[0,1,0],2],[[0,1,1],0]]],
        [[[[0,1,0],2],[[0,0,1],0],[[0,0,0],2]],[[[0,0,1],0],[[0,1,0],2],[[0,1,1],0]]],
        [[[[0,0,1],1],[[0,1,0],2],[[0,1,1],0]],[[[0,0,0],0],[[0,0,0],1],[[0,0,0],2]]],
        [[[[0,0,1],1],[[0,1,0],2],[[0,1,1],0]]],
        [[[[0,1,0],2],[[0,0,1],1],[[0,0,0],0]],[[[0,0,0],0],[[0,0,1],1],[[0,0,1],0]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],0]]],
        [[[[0,0,0],2],[[0,0,1],1],[[0,0,1],0]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],1]]],
        [[[[0,0,0],2],[[0,0,0],0],[[0,1,0],2]],[[[0,1,0],0],[[0,1,0],2],[[0,0,0],0]]],
        [[[[0,1,0],0],[[0,1,0],2],[[0,0,0],1]]],
        [[[[0,0,1],1],[[0,0,0],0],[[0,0,0],1]],[[[0,0,0],0],[[0,0,1],1],[[0,0,1],0]]],
        [[[[0,0,0],2],[[0,0,1],1],[[0,0,1],0]]],
        [[[[0,0,0],0],[[0,0,0],1],[[0,0,0],2]]],
        []
    ];
    
})(jQuery);