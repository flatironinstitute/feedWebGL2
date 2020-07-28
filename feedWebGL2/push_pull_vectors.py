"""
Combine metric_generator and attract_repel_clusterer to derive a low dimensional layout
"""

from . import local_files
import numpy as np
import jp_proxy_widget
from jp_doodle.data_tables import widen_notebook
from jp_doodle import dual_canvas
from IPython.display import display

required_javascript_modules = [
    local_files.vendor_path("js/feedWebGL.js"),
    local_files.vendor_path("js/metric_generator.js"),
    local_files.vendor_path("js/attract_repel_clusterer.js"),
]

REQUIREMENTS_LOADED = False

def load_requirements(widget=None, silent=True, additional=()):
    """
    Load Javascript prerequisites into the notebook page context.
    """
    global REQUIREMENTS_LOADED
    if REQUIREMENTS_LOADED:
        if not silent:
            print("Not reloading requirements.")
        return
    if widget is None:
        widget = jp_proxy_widget.JSProxyWidget()
        silent = False
    # Make sure jQuery and jQueryUI are loaded.
    widget.check_jquery()
    # load additional jQuery plugin code.
    all_requirements = list(required_javascript_modules) + list(additional)
    widget.load_js_files(all_requirements)
    dual_canvas.load_requirements(widget, silent=silent)
    if not silent:
        widget.element.html("<div>Requirements for <b>chart_ipynb</b> have been loaded.</div>")
        display(widget)
    REQUIREMENTS_LOADED = True


class AttractRepelMatrix:

    def __init__(self, vectors, num_close, num_far, close_distance, far_distance):
        self.vectors = np.array(vectors, dtype=np.float)
        [self.num_vectors, self.vector_length] = self.vectors.shape
        self.num_close = int(num_close)
        self.num_far = int(num_far)
        self.close_distance = float(close_distance)
        self.far_distance = float(far_distance)

    def get_distance_and_index_matrices(self, using_widget):
        load_requirements(using_widget)
        using_widget.js_init("""
            debugger;
            var generator = element.metric_generator({
                ravelled_vectors: ravelled_vectors,
                vector_length: vector_length,
                num_vectors: num_vectors,
            })
            element.extremal_indices = generator.calculate_extremal_indices(num_close, num_far);
            generator.lose_context()
        """,
        ravelled_vectors=list(self.vectors.ravel()),
        vector_length=self.vector_length,
        num_vectors=self.num_vectors,
        num_close=self.num_close,
        num_far=self.num_far,
        )
        low_indices = using_widget.element.extremal_indices.low_indices.sync_value()
        high_indices = using_widget.element.extremal_indices.high_indices.sync_value()
        indices = np.hstack( [np.array(low_indices, dtype=np.int), np.array(high_indices, dtype=np.int) ] )
        distances = np.zeros(indices.shape, dtype=np.float)
        distances[:, :self.num_close] = self.close_distance
        distances[:, -self.num_far:] = self.far_distance
        return dict(
            low_indices=low_indices,
            high_indices=high_indices,
            indices=indices,
            distances=distances,
        )

class AttractRepelClusterer:

    def __init__(self, initial_positions, indices, distances):
        self.initial_positions = np.array(initial_positions, dtype=np.float)
        self.indices = np.array(indices, dtype=np.int)
        self.distances = np.array(distances, dtype=np.float)
        (self.npositions, self.dimension) = self.initial_positions.shape
        assert 2 <= self.dimension <= 4, "dimension must be in 2,3,4"
        assert self.indices.shape == self.distances.shape, "indices must match distances"
        (n_ind, self.indices_per_vertex) = self.indices.shape
        assert n_ind == self.npositions, "index rows must match positions rows"

    def install_in_widget(self, in_widget):
        load_requirements(in_widget)
        positions = np.zeros((self.npositions, 4), dtype=np.float)
        positions[:, :self.dimension] = self.initial_positions
        in_widget.js_init("""
            debugger;
            element.clusterer = element.attract_repel_clusterer({
                positions: positions,
                indices_per_vertex: indices_per_vertex,
                indices: indices,
                index_distances: index_distances,
            });
            element.current_positions = function () {
                return element.clusterer.get_positions(dimension);
            };
            element.centered_positions = function (diameter) {
                return element.clusterer.get_centered_positions(diameter, dimension).centered_positions;
            };
        """,
        positions=list(positions.ravel()),
        indices_per_vertex=self.indices_per_vertex,
        indices=list(self.indices.ravel()),
        index_distances=list(self.distances.ravel()),
        dimension=self.dimension,
        )
        self.widget = in_widget

class DisplayController:

    def __init__(self, vectors, labels, width, nclose, nfar, dim=3):
        self.vectors = np.array(vectors, dtype=np.float)
        (self.nvectors, self.vlength) = self.vectors.shape
        assert self.nvectors == len(labels)
        self.labels = labels
        self.width = float(width)
        self.nclose = int(nclose)
        self.nfar = int(nfar)
        self.dim = int(dim)

    def set_up_swatch(self):
        from jp_doodle import nd_frame, dual_canvas
        from IPython.display import display
        self.frame = nd_frame.swatch3d(pixels=800, model_height=self.width, auto_show=False)
        self.canvas = self.frame.in_canvas
        display(self.frame.in_canvas.debugging_display())
        # Get the affinity matrix
        A = AttractRepelMatrix(
            vectors=self.vectors,
            num_close=self.nclose,
            num_far=self.nfar,
            close_distance=0.01 * self.width,
            far_distance=self.width,
        )
        D = A.get_distance_and_index_matrices(self.canvas)
        self.indices = D["indices"]
        self.distances = D["distances"]
        self.initial_positions = self.get_initial_positions()
        self.colors = self.get_colors()
        self.clusterer = AttractRepelClusterer(
            initial_positions=self.initial_positions,
            indices=self.indices,
            distances=self.distances,
        )
        self.clusterer.install_in_widget(self.canvas)
        self.canvas.js_init(
            """
                debugger;
                element.draw_graph = function(names, positions) {
                    if (!positions) {
                        var positions = element.centered_positions(width);
                    }
                    frame.reset();
                    for (var i=0; i<positions.length; i++) {
                        var p = positions[i];
                        var label = node_labels[i];
                        var color = colors[label];
                        var name = null;
                        if (names) {
                            name = "node_" + i;
                        }
                        var txt = frame.text({
                            location: p,
                            text: "" + label,
                            background: color,
                            font: "normal 20px Arial",
                            name: name,
                        })
                    }
                    frame.fit(0.7);
                    frame.orbit_all(width);
                    return true;
                };
                
                var status = $("<div>information here</div>").appendTo(element);
                element.relax_graph = function(iterations, min_change) {
                    min_change = min_change || 0.01;
                    var count = 0;
                    var step = function() {
                        element.clusterer.step_and_feedback();
                        var info = element.clusterer.get_centered_positions(width, dimensions)
                        // draw graph with names enabled
                        if ((count % 10) == 0) {
                            element.draw_graph(false, info.centered_positions);
                        }
                        var max_shift = info.max_shift;
                        status.html("" + count + " : " + max_shift);
                        if ((min_change) && (count>0) && (max_shift < min_change)) {
                            status.html("" + count + " change too small " + max_shift);
                            return;
                        }
                        if ((iterations) && (count > iterations)) {
                            status.html("" + count + " iteration limit reached " + max_shift);
                            return;
                        }
                        count += 1
                        // otherwise run again
                        requestAnimationFrame(step);
                    };
                    step();
                    return true;
                };
                element.info = function(text) {
                    status.html(text)
                };
                element.draw_graph();
            """,
            node_labels=list(self.labels),
            width=self.width,
            frame=self.frame.element,
            colors=self.colors,
            dimensions=self.dim,
        )

    def relax(self, iterations, min_change=0.1):
        self.canvas.element.relax_graph(iterations, min_change).sync_value()
        self.canvas.element.draw_graph(True)
    
    def get_colors(self):
        labels = list(set(self.labels))
        r = 33
        g = 121
        result = {}
        for label in labels:
            b = (256 - r - g) % 256
            color = "rgb(%s,%s,%s)" % (r, g, b)
            result[label] = color
            r = (r + 43) % 256
            g = (g + 31) % 256
            # not too yellow
            if r > 200 and g > 200:
                r = r % 200
            # not too white
            if (r + b + g) > 600:
                g = g % 101
                b = b % 123
        return result

    def get_initial_positions(self):
        r = np.arange(self.nvectors)
        positions = np.zeros((self.nvectors, self.dim))
        width = self.width
        for i in range(self.dim):
            positions[:, i] = np.sin( (i+1) * r ) * (width + 1)
        #print ("positions before")
        #print(positions)
        # pull positions between previous near points
        indices = self.indices
        for i in range(self.nvectors):
            count = 0
            total = 0
            for k in range(self.nclose):
                index = indices[i, k]
                if index <= i:
                    count += 1
                    total = total + positions[index]
            if count > 1:
                positions[i] = total / count

        #print("positions after")
        #print(positions)
        return positions

