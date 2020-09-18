"""
Jupyter interface to metric cluster runner
"""


from . import local_files
import numpy as np
import jp_proxy_widget
from jp_doodle.data_tables import widen_notebook
from jp_doodle import dual_canvas
from IPython.display import display


required_javascript_modules = [
    local_files.vendor_path("js/feedWebGL.js"),
    local_files.vendor_path("js/metric_clusterer.js"),
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

class MetricClusterer:

    def __init__(self, mobile_positions, metric_array=None, fixed_positions=None, delta=0.1):
        self.delta = delta
        assert len(mobile_positions) > 1, "some mobile positions required: " + repr(len(mobile_positions))
        pos = self.positions = positions_array(mobile_positions)
        all_positions = pos
        if fixed_positions is not None:
            fixed = positions_array(fixed_positions, similar_to=pos)
            all_positions = np.stack([pos, fixed])
        self.all_positions = all_positions
        self.initial_positions = np.array(all_positions)
        (self.npositions, self.dimension) = all_positions.shape
        (self.nmobile, self.dimension) = pos.shape
        self.metric_array = None
        if metric_array is not None:
            self.metric_array = np.array(metric_array, dtype=np.float)
            self.check_metric_array()
        self.widget = None

    def install_in_widget(self, widget):
        delta = self.delta
        self.check_metric_array()
        dimensions = self.dimension
        positions = self.all_positions.tolist()
        nmobile = self.nmobile
        metric = self.metric_array.ravel().tolist()
        load_requirements(widget)
        widget.js_init("""
            element.clusterer = element.metric_clusterer({
                dimensions: dimensions,
                positions: positions,
                nmobile: nmobile,
                metric: metric,
                delta: delta,
            })
        """, dimensions=dimensions, positions=positions, nmobile=nmobile, metric=metric, delta=delta)
        self.widget = widget

    def step_and_feedback(self):
        results = self.widget.element.clusterer.step_and_feedback().sync_value()
        positions = positions_array(results["positions"])
        self.all_positions[:self.nmobile] = positions
        results["all_positions"] = self.all_positions
        return results

    def check_metric_array(self):
        assert self.metric_array.shape == (self.npositions, self.nmobile), (
            "metric must match points." + repr((self.metric_array.shape, (self.npositions, self.nmobile),)))

def positions_array(array_like, similar_to=None):
    result = np.array(array_like, dtype=np.float)
    (nrows, ncols) = result.shape
    assert nrows > 0
    assert 2 <= ncols <= 4, "positions dimensions must be 2, 3, or 4"
    if similar_to is not None:
        assert ncols == similar_to.shape[1], "arrays should match."
    return result

class GraphDisplay:

    def __init__(self, edge_width=2, default_width=10, dimensions=3, delta=0.01):
        assert dimensions in (2, 3), "only 2d or 3d supported"
        self.delta = delta
        self.dimensions = dimensions
        self.edge_width = edge_width
        self.default_width = default_width
        self.edges = set()
        self.nodes = set()
        self.node_list = None
        self.matrix = None
        self.positions = None

    def add_edge(self, n1, n2):
        if n1 == n2:
            return  # ignore self loop
        assert self.matrix is None
        e = frozenset([n1, n2])
        self.edges.add(e)
        self.nodes.add(n1)
        self.nodes.add(n2)

    def compile_matrix(self):
        ew = self.edge_width
        nodes = self.node_list = list(sorted(self.nodes))
        node2index = dict((node, index) for (index, node) in enumerate(nodes))
        self.node2index = node2index
        n = len(nodes)
        matrix = np.zeros((n,n), dtype=np.float) + self.default_width
        for (n1, n2) in self.edges:
            i1 = node2index[n1]
            i2 = node2index[n2]
            matrix[i1, i2] = matrix[i2, i1] = ew
        self.matrix = matrix

    def set_up_swatch(self):
        from jp_doodle import nd_frame
        if self.matrix is None:
            self.compile_matrix()
        self.frame = nd_frame.swatch3d(pixels=800, model_height=self.default_width)
        nnodes = len(self.nodes)
        positions = self.default_width * (0.5 - np.random.random((nnodes, self.dimensions)))
        if self.dimensions == 2:
            positions3 = np.zeros((nnodes, 3), dtype=np.float)
            positions3[:, 0:2] = positions
            positions = positions3
        C = self.clusterer = MetricClusterer(positions, self.matrix, delta=self.delta)
        C.install_in_widget(self.frame.in_canvas)
        self.frame.in_canvas.js_init("""
            element.draw_graph = function() {
                var positions = element.clusterer.get_positions();
                frame.reset();
                for (var index=0; index<nodes.length; index++) {
                    var node = nodes[index];
                    var i = node2index[node];
                    var p = positions[i];
                    frame.text({ location: p, text: ""+node, background: "yellow"});
                }
                for (var index=0; index<edges.length; index++) {
                    var e = edges[index];
                    var n1 = e[0];
                    var n2 = e[1];
                    var i1 = node2index[n1];
                    var i2 = node2index[n2];
                    var p1 = positions[i1];
                    var p2 = positions[i2];
                    frame.line({ location1: p1, location2: p2, color:"red" });
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
                    var info = element.clusterer.step_and_feedback();
                    element.draw_graph();
                    var max_shift = info.max_shift;
                    count += 1
                    status.html("" + count + " : " + max_shift);
                    if ((min_change) && (max_shift < min_change)) {
                        status.html("" + count + " change too small " + max_shift);
                        return;
                    }
                    if ((iterations) && (count > iterations)) {
                        status.html("" + count + " iteration limit reached " + max_shift);
                        return;
                    }
                    // otherwise run again
                    requestAnimationFrame(step);
                };
                step();
            };
        """,
        node2index=self.node2index,
        nodes=self.node_list,
        edges=[list(e) for e in self.edges],
        width=self.default_width,
        frame=self.frame.element,
        )
        self.draw_graph()

    def draw_graph(self):
        self.frame.in_canvas.element.draw_graph()

    def step(self, iterations=None, min_change=None):
        self.frame.in_canvas.element.relax_graph(iterations, min_change)


