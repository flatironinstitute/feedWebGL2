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

    def __init__(self, mobile_positions, metric_array=None, fixed_positions=None):
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

    def install_in_widget(self, widget, delta=0.1):
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
        return self.widget.element.clusterer.step_and_feedback().sync_value()

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

