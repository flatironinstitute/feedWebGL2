
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
                // parameters needed by location method if any. (not used yet)
                location_parameters: null,
                // seed for "cut" feature [i, j, k, block], no cut if null
                seed_xyzblock: null,
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
            // Allocate edge data structures -- each originates 3 edges
            this.edge_limit = 3 * Math.trunc(s.shrink_factor * grid_size + 1);
            // XXXX DEBUG ONLY
            //this.edge_limit = 7;
            // XXXX end debug
            this.num_edge_triples = 3 * this.edge_limit;
            this.edge_number_to_triangle_number = new Int32Array(this.edge_limit);
            this.edge_number_to_triangle_rotation = new Int8Array(this.edge_limit);
            // must be UInt32Array to get three.js to use the index correctly
            this.edge_index_triples = new Uint32Array(this.num_edge_triples);
            this.edge_weight_triples = new Float32Array(this.num_edge_triples);
            // Allocate triangle index data structure (xxxx same size as edges?)
            this.triangle_index_triples = new Uint32Array(this.num_edge_triples);
            // totaal number of edges: 3 directions for each voxel
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
                    edge_limit: this.edge_limit,
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
            this.positions = null;
            this.normals = null;
            this.colors = null;
            this.linearized_positions = null;
            this.linearized_normals = null;
            this.after_run = null;
        };
        run() {
            var indexer = this.indexer;
            indexer.run();
            this.voxel_indices = indexer.voxel_index_array;
            this.generate_triangles();
            var positioner = this.positioner;
            positioner.run();
            var positions = positioner.positions;
            this.positions = positions;
            this.normals = positioner.normals;
            this.colors = positioner.colors;
            // compute basic stats
            var mins = [positions[0], positions[1], positions[2], ]
            var maxes = [positions[0], positions[1], positions[2], ]
            var active_vertex_count = this.active_vertex_count;
            for (var vertex_num=0; vertex_num<active_vertex_count; vertex_num++) {
                var first_column = vertex_num * 3;
                for (var dimension=0; dimension<3; dimension++) {
                    var vertex_coord = positions[first_column + dimension];
                    maxes[dimension] = Math.max(maxes[dimension], vertex_coord);
                    mins[dimension] = Math.min(mins[dimension], vertex_coord);
                }
            }
            var radius = 0;
            var mid = [0, 0, 0];
            for (var dimension=0; dimension<3; dimension++) {
                var m = mins[dimension];
                var M = maxes[dimension];
                var diff = M - m;
                radius = Math.max(radius, diff);
                mid[dimension] = 0.5 * (M + m);
            }
            this.radius = radius;
            this.mid_point = mid;
            this.mins = mins;
            this.maxes = maxes;
            if (this.after_run) {
                // post processing callback
                this.after_run();
            }
        };
        get_linearized_vectors(vectors, buffer, clean) {
            // for backwards compatibility -- de-index positions or normals
            var num_triangle_triples = this.num_edge_triples;
            var linearized_length = num_triangle_triples * 3;
            if (!buffer) {
                buffer = new Float32Array(linearized_length);
            }
            var triangle_index_triples = this.triangle_index_triples;
            var count = 0;
            var drawn_vertex_count = this.drawn_vertex_count;
            for (var vertex_count=0; vertex_count<drawn_vertex_count; vertex_count++) {
                var vertex_first_column = triangle_index_triples[vertex_count] * 3;
                for (var offset=0; offset<3; offset++) {
                    buffer[count] = vectors[vertex_first_column + offset];
                    count ++;
                }
            }
            if (clean) {
                // zero out remainder
                while (count < linearized_length) {
                    buffer[count] = 0;
                    count ++;
                }
            }
            return buffer;
        };
        get_positions(buffer, clean) {
            //  get linearized triangle vertex positions.
            buffer = buffer || this.linearized_positions;
            this.linearized_positions = this.get_linearized_vectors(this.positions, buffer, clean);
            return this.linearized_positions;
        };
        get_normals(buffer, clean) {
            //  get linearized triangle vertex normals.
            buffer = buffer || this.linearized_normals;
            this.linearized_normals = this.get_linearized_vectors(this.normals, buffer, clean);
            return this.linearized_normals;
        };
        set_threshold(threshold) {
            this.settings.threshold = threshold;
            this.indexer.runner.change_uniform("threshold", [threshold]);
        }
        set_grid_limits(grid_mins, grid_maxes) {
            var s = this.settings;
            s.grid_min = grid_mins;
            s.grid_max = grid_maxes;
        };
        set_seed (xyz_block) {
            this.settings.seed_xyzblock = xyz_block;
        };
        
        linked_three_geometry(THREE, clean, normal_binning) {
            var that = this;
            var linearized_positions = this.get_positions();
            var linearized_normals = this.get_normals();
            var geometry = new THREE.BufferGeometry();
            geometry.setAttribute( 'position', new THREE.BufferAttribute( linearized_positions, 3 ) );
            geometry.setAttribute( 'normal', new THREE.BufferAttribute( linearized_normals, 3 ) );
            geometry.setDrawRange( 0, that.drawn_vertex_count );
            that.link_needs_update = false;
            var after_run = function() {
                that.link_needs_update = true;
            };
            that.after_run = after_run;
            var check_update_link = function () {
                if (that.link_needs_update) {
                    var mid = that.mid_point;
                    var linearized_positions = this.get_positions();
                    var linearized_normals = this.get_normals();
                    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(mid[0], mid[1], mid[2]), that.radius);
                    geometry.attributes.position.array = linearized_positions;
                    geometry.attributes.position.needsUpdate = true;
                    geometry.attributes.normal.array = linearized_normals;
                    geometry.attributes.normal.needsUpdate = true;
                    geometry.setDrawRange( 0, that.drawn_vertex_count );
                    that.link_needs_update = false;
                }
            }
            this.check_update_link = check_update_link;
            geometry.check_update_link = check_update_link;
            return geometry;
        }

        xxx_linked_three_geometry_indexed(THREE, clean, normal_binning) {
            // this doesn't work for large models on my Mac Laptop.  I think it's a GPU limitation...
            // compatibility...
            var that = this;
            var triangle_index_triples = this.triangle_index_triples;
            var positions = this.positions;
            var normals = this.normals;
            var geometry = new THREE.BufferGeometry();
            //geometry.setIndex(new THREE.Int32BufferAttribute(triangle_index_triples, 3) );
            //geometry.setIndex(Array.from(triangle_index_triples));
            var index = new THREE.Uint32BufferAttribute(triangle_index_triples, 1);
            geometry.setIndex(index);
            geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
            geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
            var that = this;
            that.link_needs_update = false;
            var after_run = function() {
                that.link_needs_update = true;
            };
            that.after_run = after_run;
            var check_update_link = function () {
                if (that.link_needs_update) {
                    var mid = that.mid_point;
                    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(mid[0], mid[1], mid[2]), that.radius);
                    geometry.attributes.position.array = positions;
                    geometry.attributes.position.needsUpdate = true;
                    geometry.attributes.normal.array = normals;
                    geometry.attributes.normal.needsUpdate = true;
                    // https://stackoverflow.com/questions/43449909/update-indices-of-a-buffergeometry-in-three-js
                    /*
                    var index_array = geometry.index.array;
                    var triangle_index_triples = that.triangle_index_triples;
                    var ntriples = triangle_index_triples.length;
                    for (var i=0; i<ntriples; i++) {
                        index_array[i] = triangle_index_triples[i];
                    }
                    */
                    geometry.index.array = triangle_index_triples;
                    geometry.index.needsUpdate = true;
                    that.link_needs_update = false;
                }
            }
            this.check_update_link = check_update_link;
            geometry.check_update_link = check_update_link;
            return geometry;
        }

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
            var edge_limit = this.edge_limit;
            // store triangle number and rotation used to complete incident edges for each output edge
            var edge_number_to_triangle_number = this.edge_number_to_triangle_number;
            var edge_number_to_triangle_rotation = this.edge_number_to_triangle_rotation;
            //var edge_number_to_triangle_number = new Int32Array(edge_limit);
            // initialize all output arrays to dummy values
            for (var index=0; index<num_triples; index++) {
                edge_index_triples[index] = -1;
                edge_weight_triples[index] = -1.0;
                // initialize all triangle indices to 0, a valid index (degenerate triangles)
                triangle_index_triples[index] = 0;
            }
            for (var index=0; index<edge_limit; index++) {
                edge_number_to_triangle_number[index] = -1
            }
            for (var index=0; index<nedges; index++) {
                edge_index_to_compressed_index[index] = -1;
            }
            // main logic:
            var [I, J, K] = this.shape;
            var [Ioffset, Joffset, Koffset] = [J*K, K, 1];
            // Compute array index limits
            var high_limits = [I-1, J-1, K-1];
            var low_limits = [0, 0, 0]
            var grid_min = s.grid_min;
            var grid_max = s.grid_max;
            for (var dimension=0; dimension<3; dimension++) {
                var m = grid_min[dimension];
                var M = grid_max[dimension];
                var l = low_limits[dimension];
                var L = high_limits[dimension];
                if ((m > 0) && (m > l) && (m < L)) {
                    low_limits[dimension] = m;
                }
                if ((M > 0) && (M < L)) {
                    high_limits[dimension] = M;
                }
            }
            var [I0, J0, K0] = low_limits;
            var [I1, J1, K1] = high_limits;
            //var voxel_number = 0;
            var seed_xyzblock = s.seed_xyzblock;
            if (seed_xyzblock) {
                var seed_ok = true;
                for (var dim=0; dim<3; dim++) {
                    seed_ok = seed_ok && (low_limits[dim]<=seed_xyzblock[dim]) && (high_limits[dim]>seed_xyzblock[dim])
                }
                if (!seed_ok) {
                    console.log("Seed for surface cut not in range", low_limits, seed_xyzblock, high_limits);
                } else {
                    // Cut out voxels connected to the seed index, using transitive closure
                    var [i, j, k, b] = seed_xyzblock;
                    var voxel_number = (i * Ioffset) + (j * Joffset) + (k * Koffset);
                    var horizon = [voxel_number];
                    if (voxel_indices[voxel_number] < 0) {
                        throw new Error("Invalid negative voxel index before cutting.")
                    }
                    voxel_indices[voxel_number] = - voxel_indices[voxel_number];
                    // visit all voxels with positive voxel numbers reachable from horizon.
                    // When the loop is complete negative voxel_indices represent visited voxels.
                    while (horizon.length > 0) {
                        var next_horizon = [];
                        for (var index=0; index<horizon.length; index++) {
                            var ijk = horizon[index];
                            // mark ijk as visited (negate the voxel index)
                            //voxel_indices[ijk] = - voxel_indices[ijk] NOT HERE!
                            // look for unvisited adjacent voxels...
                            var k0 = ijk % K;
                            var ij = (ijk / K) | 0;
                            var j0 = ij % J;
                            var i0 = (ij / J) | 0;
                            for (var di=-1; di<=1; di++) {
                                var i1 = i0 + di;
                                if ((i1 >= I0) && (i1 < I1)) {
                                    for (var dj=-1; dj<=1; dj++) {   
                                        var j1 = j0 + dj;
                                        if ((j1 >= J0) && (j1 < J1)) {
                                            for (var dk=-1; dk<=1; dk++) {
                                                var k1 = k0 + dk;
                                                if ((k1 >= K0) && (k1 < K1)) {
                                                    var ijk1 = (i1 * Ioffset) + (j1 * Joffset) + (k1 * Koffset);
                                                    var test = voxel_indices[ijk1];
                                                    if (test > 0) {
                                                        voxel_indices[ijk1] = - test;  // mark ijk1 visited HERE.
                                                        next_horizon.push(ijk1)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        horizon = next_horizon;
                    }
                    // Finally, negate all voxel numbers in range -- invalidate all unvisited voxels.
                    for (var i=I0; i<I1; i++) {
                        for (var j=J0; j<J1; j++) {
                            for (var k=K0; k<K1; k++) {
                                var voxel_number = (i * Ioffset) + (j * Joffset) + (k * Koffset);
                                voxel_indices[voxel_number] = - voxel_indices[voxel_number];
                            }
                        }
                    }
                }
            }
            // Main loops: For all voxels with positive voxel indices generate edge interpolations and triangles (up to index limits).
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
            for (var i=I0; i<I1; i++) {
                for (var j=J0; j<J1; j++) {
                    for (var k=K0; k<K1; k++) {
                        var voxel_number = (i * Ioffset) + (j * Joffset) + (k * Koffset);
                        var voxel_index = voxel_indices[voxel_number];
                        // for well behaved surfaces in larger volumes this test fails "almost everywhere"
                        if (voxel_index > 0)
                        {
                            var edge_base_index = voxel_number * 3;
                            // Generate a triangle for each assignment template at this voxel index.
                            var triangles_edge_offsets = assignment_offsets[voxel_index];
                            for (var t_num=0; t_num<triangles_edge_offsets.length; t_num++) {
                                var triangle_edge_offset = triangles_edge_offsets[t_num];
                                var triangle_ok = true;
                                // debug:
                                triangle_edge_indices[0] = 0;
                                triangle_edge_indices[1] = 0;
                                triangle_edge_indices[2] = 0;
                                // end debug
                                for (var v_num=0; v_num < 3; v_num++) {
                                    // determine the edge index for this vertex
                                    var edge_offset = triangle_edge_offset[v_num];
                                    var edge_index = edge_base_index + edge_offset;
                                    triangle_edge_indices[v_num] = edge_index;
                                    // initialize the edge data structures (first column) if needed
                                    if (edge_index_to_compressed_index[edge_index] < 0) {
                                        if (edge_count < edge_limit) {
                                            // populate "center" entry for edge triple
                                            var first_column = 3 * edge_count;
                                            edge_index_triples[first_column] = edge_index;
                                            edge_index_to_compressed_index[edge_index] = edge_count;
                                            edge_number_to_triangle_number[edge_count] = triangle_count;
                                            edge_number_to_triangle_rotation[edge_count] = v_num;
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
                                    //this.DEBUG_check_triangle_indices(triangle_count, edge_count);
                                }
                                if (too_many_triangles) { break; }
                            }
                        }
                        //voxel_number += 1
                    }
                    if (too_many_triangles) { break; }
                    // skip end of row (wraps)
                    //voxel_number += Koffset;
                }
                if (too_many_triangles) { break; }
                // skip last row (wraps)
                //voxel_number += Joffset;
            }
            // Calculate incident edges and copy their weights for edge triples, for computing vertex normals.
            for (var edge_index=0; edge_index<edge_count; edge_index++) {
                var triangle_number = edge_number_to_triangle_number[edge_index];
                if (triangle_number >= 0) {
                    var first_column = 3 * edge_index;
                    //var edge_center_number = edge_index_triples[first_column];
                    // find the rotation
                    var rotation = TRIANGLE_ROTATIONS[edge_number_to_triangle_rotation[edge_index]];
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
            this.active_vertex_count = edge_count;
            this.drawn_vertex_count = Math.min(triangle_count, triangle_limit);
        };
        DEBUG_check_triangle_indices(triangle_count, edge_count) {
            var s = this.settings;
            var threshold = s.threshold;
            //var voxel_indices = this.voxel_indices;
            //var assignment_offsets = this.assignment_offsets;
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
            var edge_limit = this.edge_limit;
            // store triangle number and rotation used to complete incident edges for each output edge
            var edge_number_to_triangle_number = this.edge_number_to_triangle_number;
            var edge_number_to_triangle_rotation = this.edge_number_to_triangle_rotation;
            var [I, J, K] = this.shape;
            var [Ioffset, Joffset, Koffset] = [J*K, K, 1];
            var anomaly = function(message) {
                console.log(message);
                //debugger;
                // don't throw an error to permit debug test runs
            };
            if ((triangle_count % 3) != 0) {
                anomaly("bad triangle count: " + triangle_count);
            }
            var triangle_edge_indices = [-1, -1, -1];
            var edge_vertices = [];
            for (var v_num=0; v_num < 3; v_num++) {
                var triangle_index = triangle_count + v_num;
                var compressed_index = triangle_index_triples[triangle_index];
                if ((compressed_index < 0) || (compressed_index >= edge_count)) {
                    anomaly("bad compressed_index: " + compressed_index);
                }
                var edge_first_column = compressed_index * 3;
                var edge_index = edge_index_triples[edge_first_column];
                if ((edge_index < 0) || (edge_index > nedges)) {
                    anomaly("bad edge_index: "+ edge_index);
                }
                triangle_edge_indices[v_num] = edge_index;
                var dimension = edge_index % 3;
                // ijk is sometimes not the same as voxel number.
                var ijk = (edge_index / 3) | 0; //Math.floor(edge_index / 3);
                var k0 = ijk % K;
                var ij = (ijk / K) | 0;
                var j0 = ij % J;
                var i0 = (ij / J) | 0;
                var P0 = [i0, j0, k0];
                var P1 = [i0, j0, k0];
                P1[dimension] += 1;
                edge_vertices.push(P1);
                edge_vertices.push(P0);
            }
            // check the edge vertices
            var mins = [...[edge_vertices[0]]];
            var maxes = [...mins];
            for (var i=0; i<edge_vertices.length; i++) {
                var v = edge_vertices[i];
                for (var dim=0; dim<3; dim++) {
                    var vdim = v[dim];
                    mins[dim] = Math.min(mins[dim], vdim);
                    maxes[dim] = Math.max(maxes[dim], vdim);
                }
            }
            for (var dim=0; dim<3; dim++) {
                var diff = maxes[dim] - mins[dim];
                if ((diff < 0) || (diff > 1)) {
                    anomaly("bad vertex diff" + [diff, dim]);
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
        report("radius " + marching.radius);
        report("mins: " + marching.mins);
        report("maxes: " + marching.maxes);
        report("mid_point: " + marching.mid_point);

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
                edge_limit: -1,
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
                    vColor: {num_components: 3},
                },
            });

            this.edge_index_buffer = ctx.buffer();
            this.edge_index_buffer.initialize_from_array(s.edge_index_triples);
            this.edge_weight_buffer = ctx.buffer();
            this.edge_weight_buffer.initialize_from_array(s.edge_weight_triples);

            this.runner = this.program.runner({
                num_instances: 1,
                vertices_per_instance: s.edge_limit,
                uniforms: {
                    // threshold value
                    //threshold: {
                    //    vtype: "1fv",
                    //    default_value: [s.threshold],
                    //},
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
            this.colors = this.runner.feedback_array("vColor", this.colors);
        }
    };

    const marchingCubesPositionerShader = `#version 300 es

    // iso-surface theshold
    //uniform float threshold;

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
    out vec3 vPosition, vNormal, vColor;

    const float very_negative = -1e20;

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
        vPosition = vec3(very_negative, very_negative, very_negative);
        vNormal = vec3(-1.0, 0.0, 0.0);
        vColor = vec3(1.0, 0, 0);
        if (indices[0] >= 0) {
            vec3 center = interpolated_edge_position(indices[0], weights[0]);
            vec3 left = interpolated_edge_position(indices[1], weights[1]);
            vec3 right = interpolated_edge_position(indices[2], weights[2]);
            vec3 v_right = right - center;
            vec3 v_left = left - center;
            vec3 v_norm = cross(v_right, v_left);
            v_norm = normalize(v_norm);
            // uncomment
            vPosition = center;
            vNormal = v_norm;
            vColor = 0.5 * (1.0 + v_norm);
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