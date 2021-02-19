// jQuery plugin for generating triangulations representing stream lines.
//  Uses feedWebGL2
(function($) {

    $.fn.streamLiner = function(options) {
        return new StreamLiner(options);
    };

    class StreamLiner {
        constructor(options) {
            this.settings = $.extend({
                feedbackContext: null,
                // initial interpolation
                interpolation: 0.0,
                // sequence of 4-tuple weights defining the shape of the "sprite" (default paper airplane)
                sprite_shape_weights: PAPER_AIRPLANE_WEIGHTS,
                sprite_shape_normals: PAPER_AIRPLANE_NORMALS,
                // sequence of streamlines -- each streamline as a sequence of triples.
                stream_lines: null,
                // scaling factor for sprite basis vectors
                basis_scale: 1.0,
                epsilon: 1e-5,
            }, options);
            var s = this.settings;
            var stream_lines = s.stream_lines;
            if ((!stream_lines) || (!(stream_lines[0])) || (!(stream_lines[0][0]))) {
                throw new Error("sequence of stream lines containing points is required.");
            }
            if (!s.feedbackContext) {
                throw new Error("feedback context is required.")
            }
            // ravel together stream points and validity indicators.
            var stream_sequence = [];
            var validity_sequence = [];
            var mins = [...stream_lines[0][0]];
            var maxes = [...mins];

            for (var i=0; i<stream_lines.length; i++) {
                var stream = stream_lines[i];
                for (var j=0; j<stream.length; j++) {
                    var point = stream[j];
                    for (var k=0; k<3; k++) {
                        var pk = point[k];
                        if ( (typeof pk) !== "number") {
                            throw new Error("Stream lines should be sequence of sequence of 3d points.")
                        }
                        stream_sequence.push(pk);
                        mins[k] = Math.min(mins[k], pk)
                        maxes[k] = Math.max(maxes[k], pk)
                    }
                    validity_sequence.push(1);
                }
                // end of stream sentinel
                for (var k=0; k<3; k++) {
                    stream_sequence.push(0);
                }
                validity_sequence.push(0);
            }
            this.mins = mins;
            this.maxes = maxes;
            
            // set up input buffers
            var stream_buffer = s.feedbackContext.buffer();
            stream_buffer.initialize_from_array(new Float32Array(stream_sequence));
            var validity_buffer = s.feedbackContext.buffer();
            validity_buffer.initialize_from_array(new Int32Array(validity_sequence));
            var sprite_buffer = s.feedbackContext.buffer();
            sprite_buffer.initialize_from_vectors(s.sprite_shape_weights);
            var sprite_normal_buffer = s.feedbackContext.buffer();
            sprite_normal_buffer.initialize_from_vectors(s.sprite_shape_normals);

            this.program = s.feedbackContext.program({
                vertex_shader: streamline_shader,
                feedbacks: {
                    vertex_position: {num_components: 3},
                    normal: {num_components: 3},
                    //is_valid: {num_components: 1, type: "int"},
                    // DEBUG ONLY:
                    //n_straight: {num_components: 3},
                    //n_horizontal: {num_components: 3},
                },
            });

            this.runner = this.program.runner({
                vertices_per_instance: s.sprite_shape_weights.length,
                num_instances: validity_sequence.length - 3,
                rasterize: false,
                uniforms: {
                    interpolation: {
                        vtype: "1fv",
                        default_value: [s.interpolation + 0,],
                    },
                    epsilon: {
                        vtype: "1fv",
                        default_value: [s.epsilon],
                    },
                    basis_scale: {
                        vtype: "1fv",
                        default_value: [s.basis_scale],
                    },
                },
                inputs: {
                    PA: {
                        per_vertex: false,
                        num_components: 3,
                        from_buffer: {
                            name: stream_buffer.name,
                            skip_elements: 0,
                        },
                    },
                    PB: {
                        per_vertex: false,
                        num_components: 3,
                        from_buffer: {
                            name: stream_buffer.name,
                            skip_elements: 1,
                        },
                    },
                    PC: {
                        per_vertex: false,
                        num_components: 3,
                        from_buffer: {
                            name: stream_buffer.name,
                            skip_elements: 2,
                        },
                    },
                    PD: {
                        per_vertex: false,
                        num_components: 3,
                        from_buffer: {
                            name: stream_buffer.name,
                            skip_elements: 3,
                        },
                    },
                    Avalid: {
                        per_vertex: false,
                        type: "int",
                        num_components: 1,
                        from_buffer: {
                            name: validity_buffer.name,
                            skip_elements: 0,
                        },
                    },
                    Bvalid: {
                        per_vertex: false,
                        type: "int",
                        num_components: 1,
                        from_buffer: {
                            name: validity_buffer.name,
                            skip_elements: 1,
                        },
                    },
                    Cvalid: {
                        per_vertex: false,
                        type: "int",
                        num_components: 1,
                        from_buffer: {
                            name: validity_buffer.name,
                            skip_elements: 2,
                        },
                    },
                    Dvalid: {
                        per_vertex: false,
                        type: "int",
                        num_components: 1,
                        from_buffer: {
                            name: validity_buffer.name,
                            skip_elements: 3,
                        },
                    },
                    weights: {
                        per_vertex: true,
                        num_components: 4,
                        from_buffer: {
                            name: sprite_buffer.name,
                            skip_elements: 0,
                        },
                    },
                    normal_weights: {
                        per_vertex: true,
                        num_components: 3,
                        from_buffer: {
                            name: sprite_normal_buffer.name,
                            skip_elements: 0,
                        },
                    },
                },
            });
            this.update_geometry = null;
            // end of constructor
        };
        run (interpolation) {
            this.runner.change_uniform("interpolation", [interpolation]);
            this.runner.run();
            // update the geometry if defined
            if (this.update_geometry) {
                this.update_geometry();
            }
        };
        vertex_array(interpolation, optionalPreAllocatedArrayBuffer) {
            this.run(interpolation);
            // validity flag is not needed for render (invalid triangles have 0 area)
            return this.vertex_positions(optionalPreAllocatedArrayBuffer);
        };
        vertex_positions(optionalPreAllocatedArrayBuffer) {
            // DEBUG ONLY
            //this.n_straight = this.runner.feedback_array("n_straight");
            //this.n_horizontal = this.runner.feedback_array("n_horizontal");
            // END DEBUG ONLY
            this._vertex_positions = this.runner.feedback_array("vertex_position", optionalPreAllocatedArrayBuffer);
            return this._vertex_positions;
        };
        vertex_normals(optionalPreAllocatedArrayBuffer) {
            return this.runner.feedback_array("normal", optionalPreAllocatedArrayBuffer);
        };
        linked_three_geometry(THREE) {
            var that = this;
            this.runner.run();
            var positions = this.vertex_positions();
            var normals = this.vertex_normals();
            var geometry = new THREE.BufferGeometry();
            geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
            geometry.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );
            this.update_geometry = function() {
                geometry.attributes.position.array = that.vertex_positions(geometry.attributes.position.array);
                geometry.attributes.position.needsUpdate = true;
                geometry.attributes.normal.array = that.vertex_normals(geometry.attributes.normal.array);
                geometry.attributes.normal.needsUpdate = true;
            };
            return geometry;
        };
    };

    const PAPER_AIRPLANE_WEIGHTS = [
        // [wP0, w_straight, s_horizontal, w_vertical]
        // first triangle [P1, P0+h, P0]
        [0, 0, 0, 0], [1, 0, 1, 0], [1, 0, 0, 0],
        // second triangle [P1, P0+v, P0]
        [1, 0, 0, 0], [1, 0, 0, 1], [0, 0, 0, 0],
    ];
    const PAPER_AIRPLANE_NORMALS = [
        // normal to first triangle is vertical basis vector
        [0, 1, 1], [0, 0, 1], [0, 1, 1], 
        // normal to second triangle is horizontal basis vector
        [0, 1, 1], [0, 1, 0], [0, 1, 1], 
    ];

    const streamline_shader = `#version 300 es

    // Animation interpolation (should usually be normalized to be in [0, 1])
    uniform float interpolation;
    // A small number in this reference frame.
    uniform float epsilon;
    // Scaling factor for basis vector weights
    uniform float basis_scale;

    // "per mesh" streamline points and validity indicator
    in vec3 PA, PB, PC, PD;
    in int Avalid, Bvalid, Cvalid, Dvalid;

    // per vertex weights for combining points and offset vectors P0, P1, Vh, Vp
    in vec4 weights;
    // per vertex normal weignts for combining w_s, w_h, w_v to compute triangle normal
    in vec4 normal_weights;

    // Output vertex position and validity flag
    flat out int is_valid;
    out vec3 vertex_position;
    out vec3 normal;
    out vec3 n_straight;    // debugging output
    out vec3 n_horizontal;  // debugging output

    void main() {
        // default output values
        is_valid = 0;  // default to invalid
        vertex_position = vec3(0.0, 0.0, 0.0);  // arbitrary
        normal = vec3(1.0, 0.0, 0.0);
        // default values
        n_straight = vec3(1.0, 0.0, 0.0);  // unit in direction P0 --> P1
        n_horizontal = vec3(0.0, 1.0, 0.0);  // unit offset along offset of turn P0-P1-P2
        vec3 n_vertical = vec3(0.0, 0.0, 1.0);  // the other unit basis vector in 3d.
        vec3 P0, P1, P2;
        float lmd, lmd1;
        // if B or C are invalid then this vertex is at a "break' in the streamline.
        if ((Bvalid > 0) && (Cvalid > 0)) {
            is_valid = 1;
            //float lmd = floor(interpolation);
            // do not automatically force interpolation into range [0...1]? xxxx
            lmd = interpolation;
            lmd1 = 1.0 - lmd;
            // P0, P1, P2 are interpolated points on the streamline.
            P0 = PB;
            if (Avalid > 0) {
                P0 = lmd1 * PA + lmd * PB;  // interpolate
            }
            P1 = lmd1 * PB + lmd * PC;  // always interpolate
            P2 = PC;
            if (Dvalid > 0) {
                P2 = lmd1 * PC + lmd * PD;  // interpolate
            }
            vec3 V1 = P1 - P0;
            float lV1 = length(V1);
            // if P0 ~= P1 use arbitrary default basis vectors, otherwise...
            if (lV1 > epsilon) {
                n_straight = V1 / lV1;
                vec3 V2 = P2 - P1;
                float lV2 = length(V2);
                vec3 W2 = V2;  // The "turning direction" vector W2
                if (lV2 < epsilon) {
                    // P1 ~= P2, arbitrary choice for turn direction...
                    W2 = vec3(0.0, 1.0, 1.0);
                    if (abs(n_straight[0]) < epsilon) {
                        W2 = vec3(1.0, 0.0, 0.0);
                    } 
                    // XXXX DEBUG
                    //W2 = vec3(0.0, 1.0, 0.0);
                    //n_straight = vec3(1.0, 0.0, 0.0);
                    // XXXX END DEBUG
                }
                // XXXX DEBUG
                //W2 = vec3(0.0, 0.0, 0.0);
                //n_straight = vec3(1.0, 0.0, 0.0);
                // XXXX END DEBUG
                vec3 W2proj = W2 - (dot(W2, n_straight) * n_straight);
                float lW2proj = length(W2proj);
                if (lW2proj < epsilon) {
                    // P0, P1, P2 collinear: arbitrary choice for turn direction...
                    vec3 abs_n = abs(n_straight);
                    float ax = abs_n.x;
                    float ay = abs_n.y;
                    float az = abs_n.z;
                    if (ax > ay) {
                        if (ax > az) {
                            W2 = vec3(0.0, 1.0, 1.0);
                        } else {
                            // az is max
                            W2 = vec3(1.0, 1.0, 0.0);
                        }
                    } else if (ay > az) {
                        W2 = vec3(1.0, 0.0, 1.0);
                    } else {
                        W2 = vec3(1.0, 1.0, 0.0);
                    }
                    W2proj = W2 - (dot(W2, n_straight) * n_straight);
                    lW2proj = length(W2proj);
                }
                n_horizontal = W2proj / lW2proj;
                // find the other basis vector
                n_vertical = normalize(cross(n_straight, n_horizontal));  // cross is redundant here?
            }
            // get weight parameters for linear combo of basis vectors and P0, P1
            float wP0 = weights[0];
            float wP1 = 1.0 - wP0;
            float w_straight = weights[1];
            float w_horizontal = weights[2];
            float w_vertical = weights[3];
            // combined output.
            vertex_position = (
                (wP0 * P0) + (wP1 * P1) + 
                basis_scale * ((w_straight * n_straight) + (w_horizontal * n_horizontal) + (w_vertical * n_vertical))
            );
            float nw_straight = normal_weights[0];
            float nw_horizontal = normal_weights[1];
            float nw_vertical = normal_weights[2];
            normal = normalize((nw_straight * n_straight) + (nw_horizontal * n_horizontal) + (nw_vertical * n_vertical));
        }
        // DEBUG
        //n_straight = PA;
        //n_horizontal = PB;
        //vertex_position.x = lmd;
        //vertex_position.y = lmd1;
        //vertex_position.z = PA.z;
    }
    `;

    $.fn.streamLiner.example = function(container) {

        var gl = $.fn.feedWebGL2.setup_gl_for_example(container);

        var context = container.feedWebGL2({
            gl: gl,
        });

        var sl = container.streamLiner({
            feedbackContext: context,
            interpolation: 0.5,
            // default sprite_shape_weights
            stream_lines: [
                [
                    [0, 0, 0],
                    [5, 5, 5],
                    [5, 5, 10],
                    [5, 10, 10],
                ],
            ],
            basis_scale: 0.5,
            // default epsilon
        });
        var vertices = sl.vertex_array(0.2);
        var nv = vertices.length;
        $("<div>Got " + nv + "</div>").appendTo(container);
        var count = 0;
        while (count < nv) {
            for (var i=0; i<3; i++) {
                $("<span> " + vertices[count] + ", </span>").appendTo(container);
                count ++;
            }
            $("<br/>").appendTo(container);
        }
    };

})(jQuery);
