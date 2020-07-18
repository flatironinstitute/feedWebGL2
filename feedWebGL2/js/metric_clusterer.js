/*
// jQuery plugin for point clustering using a metric matrix
//

Structure follows: https://learn.jquery.com/plugins/basic-plugin-creation/
*/

(function($) {

    $.fn.metric_clusterer = function (options) {
        class MetricClusterer {
            constructor(options) {
                this.settings = $.extend({
                    feedbackContext: null,
                    // the number of dimensions for points (should be 2, 3, or 4)
                    dimension: 3,
                    // position is array of position arrays
                    positions: null,
                    // metric is ravelled i,j distance metric
                    metric: null,
                    // delta is shift scale factor
                    delta: 0.01,
                    // epsilon is cut-off for "too close" positions
                    epsilon: 1.0e-10,
                    // number of mobile positions (default all)
                    nmobile: null,
                }, options);
                var s = this.settings;
                if ((!s.positions) || (!s.metric)) {
                    throw new Error("positions and metric are required.");
                }
                s.npos = s.positions.length;
                s.nmobile = s.nmobile || s.npos;
                if (s.nmobile > s.npos) {
                    throw new Error("mobile positions cannot exceed positions.");
                }
                if ((s.npos * s.nmobile) != s.metric.length) {
                    throw new Error("positions and metric must match");
                }
                s.buffer_size = s.npos * 4;
                // create and fill the positions array with position data
                var pos_array = new Float32Array(s.buffer_size);
                // redundant...
                for (var i=0; i<s.buffer_size; i++) {
                    pos_array[i] = 0;
                }
                for (var i=0; i<s.npos; i++) {
                    var offset = i * 4;
                    var v = s.positions[i];
                    if (v.length != s.dimension) {
                        throw new Error("vectors must match declared dimension")
                    }
                    for (var j=0; j<s.dimensions; j++) {
                        pos_array[offset + j] = v[j];
                    }
                }
                // get the webgl context container
                var context = this.settings.feedbackContext;
                if (!context) {
                    context = $.fn.feedWebGL2({});
                }
                this.feedbackContext = context;
                // initialize buffers
                this.positions_buffer = context.buffer("positions_buffer");
                this.positions_buffer.initialize_from_array(pos_array);
                var metric_array = new Float32Array(s.metric);
                //this.metric_buffer = context.buffer("metric_buffer")  // not needed?
                this.program = context.program({
                    vertex_shader: cluster_shift_shader,
                    feedbacks: {
                        shifted_position: { num_components: 4 },
                    }
                });
                var typ = "FLOAT";
                var fmt = "RGBA";
                var ifmt = "RGBA32F";
                var width = 1;
                var height = s.npos;
                this.positions_texture = context.texture("all_positions", typ, fmt, ifmt);
                this.positions_texture.load_array(pos_array, width, height)
                this.metric_texture = context.texture("metric", "FLOAT", "RED", "R32F");
                this.metric_texture.load_array(metric_array, s.nmobile, s.npos)
                // create the runner
                this.runr = this.program.runner({
                    num_instances: 1,
                    vertices_per_instance: s.nmobile,
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
                        all_positions: {
                            dim: "2D",
                            from_texture: "all_positions",
                        },
                        metric: {
                            dim: "2D",
                            from_texture: "metric",
                        },
                    },
                });
            };
            step () {
                this.runr.run();
                return this.runr.feedback_array("shifted_position")
            };
        };

        var cluster_shift_shader = `#version 300 es

        in vec4 initial_position;

        // uniform int dimension;
        uniform float delta;
        uniform float epsilon;

        uniform sampler2D all_positions;
        uniform sampler2D metric;

        out vec4 shifted_position;

        void main() {
            vec4 position = initial_position;
            int i = gl_VertexID;
            ivec2 psize = textureSize(all_positions, 0);
            int N = psize[1];
            for (int j=0; j<N; j++) {
                if (j != i) {
                    ivec2 ji = ivec2(i, j);
                    vec4 m_color = texelFetch(metric, ji, 0);
                    // metric in R component only
                    float m = m_color.r;
                    // non-positive metric means "no influence"
                    if (m > 0.0) {
                        ivec2 j0 = ivec2(0, j);
                        vec4 position_j = texelFetch(all_positions, j0, 0);
                        // diff is vector pointing from pi to pj
                        vec4 diff = position_j - initial_position;
                        float n = length(diff);
                        if (n < epsilon) {
                            n = epsilon;
                            if (i < j) {
                                diff = vec4(epsilon, 0, 0, 0);
                            } else {
                                diff = vec4(-epsilon, 0, 0, 0);
                            }
                        }
                        float factor = n / m;
                        float logfactor = log(factor);
                        vec4 shift = (delta * logfactor / n) * diff;
                        position += shift;
                    }
                }
            }
            shifted_position = position;
        }
        `;

        return new MetricClusterer(options);
    };
    
    $.fn.metric_clusterer.example = function (container) {
        var nmobile = 4;
        var positions = [
            [1,1,1],
            [1,-1,-1],
            [-1,-1,1],
            [-1,1,-1],
        ];
        // metric array is ravelled
        var metric = [
            0, 5, 3, 2,
            5, 0, 4, 2,
            3, 4, 0, 3,
            2, 2, 3, 0,
        ];

        nmobile = 3;
        positions = [
            [2, -1, -1],
            [0, -1, -1],
            [-2, -1, -1],
            [0, 10, -1],
        ];
        metric = [
            -1, -1, -1,
            -1, -1, -1,
            6,  -1, -1,
            -1, 12, -1,
        ]
        debugger;
        var clusterer = container.metric_clusterer({
            dimensions: 3,
            positions: positions,
            nmobile: nmobile,
            metric: metric,
            delta: 1.0,  // for testing only, should be smaller normally
        });
        var array = clusterer.step();
        container.html("Got " + array.length);
    };
})(jQuery)