/*
// jQuery plugin for point clustering using a metric matrix
//

Structure follows: https://learn.jquery.com/plugins/basic-plugin-creation/
*/

(function($) {

    $.fn.metric_generator = function (options) {

        class MetricGenerator {
            constructor(options) {
                this.settings = $.extend({
                    // feedback context object
                    context: null,
                    // Float32Array of vector values, or convertible
                    ravelled_vectors: null,
                    vector_length: null,
                    num_vectors: null,
                }, options);
                var s = this.settings;
                if ((!s.ravelled_vectors) || (!s.vector_length) || (!s.num_vectors)) {
                    throw new Error("required parameter is missing.")
                }
                if (!( (s.vector_length * s.num_vectors) == s.ravelled_vectors.length )) {
                    throw new Error("vector array must match declared dimensions.")
                }
                if (!s.context) {
                    s.context = $.fn.feedWebGL2({});
                }
                var ravelled_vectors = new Float32Array(s.ravelled_vectors);
                this.vector_texture = s.context.texture("vectors", "FLOAT", "RED", "R32F");
                this.vector_texture.load_array(ravelled_vectors, s.vector_length, s.num_vectors);
                // unneeded parameters required by Firefox
                var dummy_array = new Int32Array(s.num_vectors);
                this.dummyBuffer = s.context.buffer("metricDummyBuffer");
                this.dummyBuffer.initialize_from_array(dummy_array);
                // set up the program
                s.shader = $.fn.metric_generator.metric_generator_shader();
                this.program = s.context.program({
                    vertex_shader: s.shader,
                    feedbacks: {
                        metric_value: {num_components: 1,},
                    },
                });
                // set up the runner
                this.runr = this.program.runner({
                    num_instances: s.num_vectors,
                    vertices_per_instance: s.num_vectors,
                    uniforms: {},
                    rasterize: false,
                    inputs: {
                        aRow: {
                            per_vertex: false,
                            num_components: 1, 
                            type: "int",
                            from_buffer: {
                                name: "metricDummyBuffer",
                            },
                        },
                        aCol: {
                            per_vertex: true,
                            num_components: 1,
                            type: "int",
                            from_buffer: {
                                name: "metricDummyBuffer",
                            },
                        },
                    },
                    samplers: {
                        "vectors": {
                            dim: "2D",
                            from_texture: "vectors",
                        },
                    },
                });
                this.runr.run();
                this.metric_values = this.runr.feedback_array("metric_value");
            };
            get_matrix_row(n) {
                var result = [];
                var num_vectors = this.settings.num_vectors;
                var values = this.metric_values;
                if ((n < 0) || (n >= num_vectors)) {
                    throw new Error("bad index " + n);
                }
                var start = n * num_vectors;
                for (var i = 0; i<num_vectors; i++) {
                    result.push(values[start + i]);
                }
                return result;
            };
            get_matrix() {
                var result = [];
                var num_vectors = this.settings.num_vectors;
                for (var i=0; i<num_vectors; i++) {
                    result.push(this.get_matrix_row(i));
                }
                return result;
            };
            calculate_extremal_indices(nlow, nhigh) {
                var num_vectors = this.settings.num_vectors;
                this.nhigh = nhigh;
                this.nlow = nlow;
                //this.low_indices = new Int32Array(nlow * num_vectors);
                //this.high_indices = new Int32Array(nhigh * num_vectors);
                this.low_indices = [];
                this.high_indices = [];
                var L = this.low_indices;
                var H = this.high_indices;
                // https://stackoverflow.com/questions/8273047/javascript-function-similar-to-python-range
                var index_array = Array.from(Array(num_vectors).keys());
                var row;
                var index_compare = function (i, j) { return row[i] - row[j]; }
                for (var i=0; i<num_vectors; i++) {
                    row = this.get_matrix_row(i);
                    index_array.sort(index_compare);
                    //var Lstart = nlow * i;
                    var Lrow = [];
                    var Hrow = [];
                    for (var j=0; j<nlow; j++) {
                        //L[Lstart + j] = index_array[j];  // XXX includes "identity index" i
                        Lrow.push(index_array[j])
                    }
                    //var Hstart = nhigh * i;
                    for (var j=0; j<nhigh; j++) {
                        //H[Hstart + j] = index_array[num_vectors - 1 - j];
                        Hrow.push(index_array[num_vectors - 1 - j]);
                    }
                    L.push(Lrow);
                    H.push(Hrow);
                }
                return {
                    num_vectors: num_vectors,
                    nlow: nlow,
                    nhigh: nhigh,
                    low_indices: L,
                    high_indices: H,
                }
            };
            lose_context() {
                // attempt to release resources on the GPU and elsewhere.
                this.program = null;
                this.runr = null;
                this.metric_value = null;
                this.settings.context.lose_context();
                this.settings = null;
            };
        };

        return new MetricGenerator(options);

    };

    $.fn.metric_generator.metric_generator_shader = function () {
        return `#version 300 es

        // float vectors -- data in RED component only.
        uniform sampler2D vectors;

        // rows are "per mesh"
        in int aRow;  // not used, required by Firefox
        // columns are "per vertex"
        in int aCol;  // not used, required by Firefox

        // feedback value out -- metric for vector[row] with vector[col]
        out float metric_value;

        void main() {  
            // foil the optimizer
            gl_Position = vec4(aRow, aCol, aRow, aCol);
            int iCol = gl_VertexID;
            int iRow = gl_InstanceID;
            ivec2 vsize = textureSize(vectors, 0);
            int vector_length = vsize[1];
            // assert iCol < vsize[0] and iRow < vsize[0]
            float summation = 0.0;
            for (int k=0; k<vector_length; k++) {
                float row_vector_k = texelFetch(vectors, ivec2(k, iRow), 0).r;
                float col_vector_k = texelFetch(vectors, ivec2(k, iCol), 0).r;
                // combine (manhattan)
                float row_col_combined = abs(row_vector_k - col_vector_k);
                summation += row_col_combined;
            }
            // xxx euclidean metric would sqrt summation
            metric_value = summation;
            //metric_value = 42.0;
        }
        `
    }

    $.fn.metric_generator.example = function (container) {
        debugger;
        var v = new Float32Array([
            1, 1, 1,
            0, 0, 0,
            0,-1,-1,
            2, 1, 0,
        ]);
        var G = container.metric_generator({
            ravelled_vectors: v,
            vector_length: 3,
            num_vectors: 4,
        });
        var m = G.get_matrix();
        var e = G.calculate_extremal_indices(2, 1);
        G.lose_context();
        $("<div>got " + m.length + "::" + e.high_indices.length + "</div>").appendTo(container);
        return G;
    };

})(jQuery);