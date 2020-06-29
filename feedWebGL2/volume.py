
"""
Jupyter widget for viewing a dense 3d matrix.
"""

from . import local_files
import numpy as np
import jp_proxy_widget
from jp_doodle.data_tables import widen_notebook
from jp_doodle import dual_canvas

required_javascript_modules = [
    local_files.vendor_path("js_lib/three.min.js"),
    local_files.vendor_path("js_lib/OrbitControls.js"),
    local_files.vendor_path("js/feedWebGL.js"),
    local_files.vendor_path("js/feedbackSurfaces.js"),
    local_files.vendor_path("js/volume32.js"),
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

class Volume32(jp_proxy_widget.JSProxyWidget):

    def __init__(self, *pargs, **kwargs):
        super(Volume32, self).__init__(*pargs, **kwargs)
        load_requirements(self)
        self.element.html("Uninitialized Volume widget.")
        self.options = None
        self.data = None

    def set_options(self, num_rows, num_cols, num_layers, threshold=0, shrink_factor=0.2):
        options = jp_proxy_widget.clean_dict(
            num_rows=num_rows, num_cols=num_cols, num_layers=num_layers, 
            threshold=threshold, shrink_factor=shrink_factor
        )
        self.options = options
        self.js_init("""
            element.V = element.volume32(options);
        """, options=options)

    def load_3d_numpy_array(self, ary, threshold=None, shrink_factor=0.2):
        if threshold is None:
            threshold = 0.5 * (ary.min() + ary.max());
        self.element.html("Loading shape: " + repr(ary.shape) + " " + repr([threshold, shrink_factor]))
        (num_layers, num_cols, num_rows) = ary.shape
        ary32 = np.array(ary, dtype=np.float32)
        self.set_options(num_rows, num_cols, num_layers, threshold=threshold, shrink_factor=shrink_factor)
        self.data = ary32
        ary_bytes = bytearray(ary32.tobytes())
        self.js_init("""
            debugger;
            element.uint8array = uint8array;
            element.valuesArray = new Float32Array(uint8array.buffer);
            element.V.buffer = element.valuesArray;
        """, uint8array=ary_bytes)

    def build(self, width=1200):
        assert self.options is not None, "options must be intialized"
        assert self.data is not None, "data must be provided"
        self.element.html("building")
        self.element.V.build_scaffolding(self.get_element(), width)

class Example:

    def __init__(self):
        from IPython.display import display
        widen_notebook()
    
    def get_array(self):
        x = np.linspace(-1.111, 2, 50)
        y = np.linspace(-1.111, 2, 51)
        z = np.linspace(-1.111, 2, 52)
        xv, yv, zv = np.meshgrid(x, y, z, indexing="ij")
        def distance(x0, y0, z0):
            return np.sqrt((x0-xv) ** 2 + (y0 - yv) ** 2 + (z0 - zv) **2)
        #self.ary = np.minimum(distance(0.3, 0.3, 0.3), distance(-0.7, 0.7, 0.7) / (distance(0.3, -0.7, 0.3)+0.01))
        #self.ary = xv * xv + zv * zv
        ary = (xv*yv + xv*zv + yv*zv)/(xv*yv*zv + 1)
        self.ary = np.maximum(np.minimum(ary, 1.0), -1.0)
        print ("array", self.ary.shape)

    def get_array2(self):
        shape = (nx, ny, nz) = (5,6,7)
        ary = np.zeros(shape, dtype=np.float)
        for x in range(nx):
            for y in range(ny):
                for z in range(nz):
                    ary[x, y, z] = y
        self.ary = ary
        print ("array", self.ary.shape)

    def widget(self):
        W = Volume32()
        self.W = W
        return W

    def run(self):
        W = self.W
        W.load_3d_numpy_array(self.ary, threshold=self.ary.ravel()[4])
        W.build()
    