/*
// jQuery plugin for point clustering using a metric matrix
//

Structure follows: https://learn.jquery.com/plugins/basic-plugin-creation/
*/

(function($) {

    $.fn.attract_repel_clusterer = function (options) {
        
        class AttractRepel {
            constructor(options) {
                this.settings = $.extend({
                    // feedback context object
                    context: null,
                    // 4 dimensional ravelled positions as Float32Array or convertible (0 in unused dimensions)
                    positions: null,
                    // number of influential indices per each index
                    indices_per_vertex: null,
                    // indices of influential positions for each index, ravelled Int32Array
                    indices: null,
                    // target distances for influential indices each position, ravelled Float32Array
                    index_distances: null,
                    // cut off for too close
                    epsilon: 1.0e-10,
                    // scaling factor
                    delta: 0.1,
                    // log_shift spike softener
                    log_shift: 0.1,
                }, options);
                var s = this.settings;
                if ((!s.positions) || 
                    (!s.indices_per_vertex) ||
                    (!s.indices) ||
                    (!s.index_distances)
                ) {
                    throw new Error("required parameter missing");
                }
                // could make num_vertices a parameter to support "fixed vertices"
                s.num_vertices = s.positions.length / 4;
                var num_indices = s.num_vertices * s.indices_per_vertex;
                if (s.indices.length != num_indices) {
                    throw new Error("indices don't match declared indices per vertex");
                }
                if (s.index_distances.length != num_indices) {
                    throw new Error("index lengths don't match declared indices per vertex");
                }
                if (!s.context) {
                    s.context = $.fn.feedWebGL2({});
                }
                // copy positions
                this.positions = new Float32Array(s.positions);
                this.indices = new Int32Array(s.indices);
                this.index_distances = new Float32Array(s.index_distances);
                // set up textures
                this.positions_texture = s.context.texture("positions", "FLOAT", "RGBA", "RGBA32F");
                this.positions_texture.load_array(this.positions, 1, s.num_vertices)
                this.distance_texture = s.context.texture("distance", "FLOAT", "RED", "R32F");
                this.distance_texture.load_array(this.index_distances, s.indices_per_vertex, s.num_vertices);
                this.index_texture = s.context.texture("indices", "INT", "RED_INTEGER", "R32I");
                this.index_texture.load_array(this.indices, s.indices_per_vertex, s.num_vertices);
                // set up buffers
                this.positions_buffer = s.context.buffer("positions_buffer");
                this.positions_buffer.initialize_from_array(this.positions);

                this.program = s.context.program({
                    vertex_shader: attract_repel_shader,
                    feedbacks: {
                        shifted_position: { num_components: 4 },
                        shift_length: { num_components: 1 },
                    }
                });
                this.runr = this.program.runner({
                    num_instances: 1,
                    vertices_per_instance: s.num_vertices,
                    rasterize: false,
                    uniforms: {
                        delta: {
                            vtype: "1fv",
                            default_value: [s.delta],
                        },
                        epsilon: {
                            vtype: "1fv",
                            default_value: [s.epsilon],
                        },
                        log_shift: {
                            vtype: "1fv",
                            default_value: [s.log_shift],
                        },
                    },
                    inputs: {
                        initial_position: {
                            per_vertex: true,
                            num_components: 4,
                            from_buffer: {
                                name: "positions_buffer",
                            },
                        },
                    },
                    samplers: {
                        positions: {
                            dim: "2D",
                            from_texture: "positions",
                        },
                        indices: {
                            dim: "2D",
                            from_texture: "indices",
                        },
                        index_distances: {
                            dim: "2D",
                            from_texture: "distance",
                        },
                    },
                });
                this.has_run = false;
            };
            step () {
                this.runr.run();
                this.shifted_positions_array =  this.runr.feedback_array("shifted_position");
                this.has_run = true;
                return this.shifted_positions_array;
            };
            step_and_feedback() {
                this.step();
                this.feed_back_positions();
                return this.shifted_positions_array;
            };
            feed_back_positions() {
                var pos = this.positions;
                pos.set(this.shifted_positions_array);
                this.positions_texture.reload_array(pos);
                this.positions_buffer.copy_from_array(pos);
            };
            get_positions(dimensions) {
                // get positions as array of tuple/array
                dimensions = dimensions || 4;
                var p = this.positions;
                var result = [];
                var index = 0;
                var npos = p.length;
                for (var index=0; index<npos; index+=4) {
                    var v = []
                    for (var j=0; j<4; j++) {
                        v.push(p[index + j]);
                    }
                    result.push(v);
                }
                return result;
            }
            get_centered_positions(diameter, dimensions) {
                if ((!diameter) || (!dimensions)) {
                    throw new Error("diameter and dimensions are required.")
                }
                var s_positions = this.get_positions(dimensions);
                var npos = s_positions.length;
                var mins = s_positions[0].slice();
                var maxes = mins.slice();
                for (var i=0; i<npos; i++) {
                    var p = s_positions[i];
                    for (j=0; j<dimensions; j++) {
                        var v = p[j];
                        mins[j] = Math.min(mins[j], v);
                        maxes[j] = Math.max(maxes[j], v);
                    }
                }
                var center = [];
                var diff = [];
                for (var j=0; j<dimensions; j++) {
                    var m = mins[j];
                    var M = maxes[j];
                    center.push( 0.5 * (m + M) );
                    diff.push( M - m );
                }
                var d = Math.max(...diff);
                var scale = diameter / d;
                var c_positions = [];
                for (var i=0; i<npos; i++) {
                    var p = s_positions[i];
                    var c_p = []
                    for (j=0; j<dimensions; j++) {
                        var v = p[j];
                        var c = center[j];
                        c_p.push( (v - c) * scale );
                    }
                    c_positions.push(c_p);
                }
                var max_shift = 0.0;
                if (this.has_run) {
                    var shifts = this.runr.feedback_array("shift_length");
                    for (var i=0; i<shifts.length; i++) {
                        max_shift = Math.max(shifts[i], max_shift);
                    }
                }
                return {
                    centered_positions: c_positions,
                    mins: mins,
                    maxes: maxes,
                    positions: s_positions,
                    max_shift: max_shift,
                }
            };
        };

        return new AttractRepel(options);
    };

    var attract_repel_shader = `#version 300 es

        // this vertex position to move
        in vec4 initial_position;

        // positions of vertices
        uniform sampler2D positions;

        // indices[j, vertexid] holds index of vertex to influence this vertex
        uniform highp isampler2D indices;

        // target distances for each index
        uniform sampler2D index_distances;

        uniform float delta;
        uniform float epsilon;
        uniform float log_shift;

        out vec4 shifted_position;
        out float shift_length;

        void main() {
            vec4 total_shift = vec4(0.0, 0.0, 0.0, 0.0);
            int i = gl_VertexID;
            //ivec2 psize = textureSize(positions, 0);
            //int N = psize[1];
            ivec2 isize = textureSize(index_distances, 0);
            int num_indices = isize[0];
            int index = -1;
            // add in influence for each index
            for (int j=0; j<num_indices; j++) {
                ivec2 ji = ivec2(j, i);
                // get weight
                vec4 w_color = texelFetch(index_distances, ji, 0);
                // weight in R component only
                float m = w_color.r;
                // get index
                //ivec4 index_color = texture2D(indices, ji);
                ivec4 index_color = texelFetch(indices, ji, 0);
                index = index_color.r;
                // non-positive distance metric means "no influence"
                if ((m > 0.0) && (index >= 0) && (index != i)) {
                    // get the position for this index
                    ivec2 index0 = ivec2(0, index);
                    vec4 index_position = texelFetch(positions, index0, 0);
                    // diff is vector pointing from pi to pj
                    vec4 diff = index_position - initial_position;
                    float n = length(diff);
                    if (n < epsilon) {
                        n = epsilon;
                        if (i < j) {
                            diff = vec4(epsilon, 0, 0, 0);
                        } else {
                            diff = vec4(-epsilon, 0, 0, 0);
                        }
                    }
                    const float PI = 3.1415926535897932384626433832795;
                    float n_pi_by_m = n * PI / m;
                    float factor = -1.0;
                    if (n < m * 0.5) {
                        // too close: push away
                        factor = -1.0 * sin(n_pi_by_m);
                    } else if (n < 2.0 * m) {
                        // just right... don't push
                        m = -1.0;  // mark invalid
                    } else if (n < 4.0 * m) {
                        // too far push closer (adjusted)
                        factor = 0.5 * (1.0 + sin(0.5 * (n_pi_by_m - 3.0 * PI)));
                    } else {
                        // too far plateau at 1.0
                        factor = 1.0;
                    }
                    if (m > 0.0) {
                        vec4 shift = (delta * factor / n) * diff;
                        total_shift += shift;
                    }
                    //float factor = n / m;
                    //float logfactor = log(factor + log_shift);
                    // distance weakening (disabled atm)
                    //logfactor = logfactor / log(3.0 + m);
                    //vec4 shift = (delta * logfactor / n) * diff;
                    //total_shift += shift;
                }
            } 
            shift_length = length(total_shift);
            // limit the shift to 1  // DEBUG COMMENTED FOR NOW
            if (shift_length > 1.0) {
                total_shift = total_shift / shift_length;
            }
            shifted_position = initial_position + total_shift;
        }
    `

    $.fn.attract_repel_clusterer.example = function (container) {
        debugger;
        var v = new Float32Array([
            1, 1, 0, 0,
            2, 0, 0, 0,
            3, 3, 0, 0,
        ]);
        var ind = new Int32Array([
            0,1,2,
            0,1,2,
            0,1,2,
        ]);
        var dist = new Float32Array([
            3,4,5,
            3,4,5,
            3,4,5,
        ]);
        var C = container.attract_repel_clusterer({
            positions: v,
            indices_per_vertex: 3,
            indices: ind,
            index_distances: dist,
        });
        var shifted = C.step_and_feedback();
        //var lengths = C.runr.feedback_array("shift_length")
        var centered = C.get_centered_positions(10.0, 2);
        $("<div> got " + shifted.length + " </div>").appendTo(container);
    };

})(jQuery);