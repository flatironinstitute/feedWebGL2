"""
A Jupyter widget for exploring, viewing, and modifying 3 dimensional arrays
in HDF5 files in a folder.
"""

import ipywidgets as widgets
import h5py
import numpy as np
from . import volume
from IPython.display import display
import os

class Explorer:

    def __init__(self, folder=".", filters=None, width=1000, shape_max=100):
        self.folder = folder
        self.filters = filters
        self.width = width
        self.shape_max = shape_max
        self.current_file = None
        self.current_key = None
        self.current_image = None
        self.error = None
        widget = self.make_widget()
        display(widget)

    def make_widget(self):
        self.file_tab = FileTab(self)
        self.load_tab = LoadTab(self)
        self.tabs = [
            self.file_tab,
            self.load_tab,
        ]
        self.info = widgets.HTML("<div>hdf5 explorer</div>")
        self.volume = volume.Volume32()
        self.volume.element.html("No image yet loaded.")
        tab_children = [t.widget() for t in self.tabs]
        self.tab_widget = widgets.Tab(children=tab_children)
        for (i, t) in enumerate(self.tabs):
            self.tab_widget.set_title(i, t.title)
            t.index = i
        self.assembly = widgets.VBox([self.info, self.tab_widget, self.volume])
        return self.assembly

    def update_all(self):
        for t in self.tabs:
            t.update()
        image = self.current_image 
        if image is not None:
            ss_image = self.sub_sample(image)
            W = self.volume
            W.load_3d_numpy_array(ss_image, ss_image.mean())
            W.build(width=self.width)

    def sub_sample(self, image):
        (I, J, K) = image.shape
        shape_max = self.shape_max
        M = max(I, J, K)
        stride = int(M / shape_max)
        Is = int(I / stride)
        Js = int(J / stride)
        Ks = int(K / stride)
        ss_image = image[0 : Is * stride: stride, 0 : Js * stride: stride, 0 : Ks * stride: stride]
        return ss_image

    def get_file(self, filename=None, mode="r"):
        filename = filename or self.current_file
        if filename:
            file_path = os.path.join(self.folder, filename)
            self.info.value = "<div>attempting to open %s</div>" % file_path
            try:
                hdf5_file = h5py.File(file_path, mode)
            except Exception as e:
                self.error = e
                self.info.value = "<div>Error encountered when opening %s</div>" % file_path
            else:
                self.info.value = "<div>opened %s</div>" % file_path
                return hdf5_file
        else:
            self.info.value = "<div>No file is selected</div>"
        return None # fail

class FileTab:

    title = "File"

    def __init__(self, in_explorer):
        self.in_exporer = in_explorer

    def widget(self):
        html1 = widgets.HTML("<H1>Select file.</H1>")
        self.info = widgets.HTML("<div>No file chosen.</div>")
        self.dropdown = widgets.Dropdown(options=["file list not loaded..."])
        def dropdown_change(change):
            if change['type'] != 'change' or change.get("name") != 'value':
                return
            new = self.dropdown.value
            if new != self.option0:
                ex = self.in_exporer
                f = ex.get_file(new)
                if f:
                    self.button.disabled = False
                    self.info.value = "<div>%s contains %s objects, Press the button to select.</div>" % (new, len(f))
                    f.close()
                else:
                    self.info.value = "<div>Could not open hdf5 file %s</div>" % new
            else:
                self.button.disabled = True
        self.dropdown.observe(dropdown_change)
        self.button = widgets.Button(
            description="Select file",
            disabled=True,
        )
        def button_click(b):
            ex = self.in_exporer
            ex.current_file = self.dropdown.value
            ex.info.value = "<div>Selected file %s</div>" % ex.current_file
            ex.update_all()
        self.button.on_click(button_click)
        self.assembly = widgets.VBox(children=[html1, self.dropdown, self.info, self.button])
        self.update()
        return self.assembly

    def update(self):
        ex = self.in_exporer
        folder = self.in_exporer.folder
        filenames = os.listdir(folder)
        h5files = [fn for fn in filenames if fn.endswith(".h5")]
        self.option0 = "(not chosen)"
        h5files = [self.option0] + h5files
        self.dropdown.options = h5files
        message = "No file chosen."
        if ex.current_file:
            message = "Current file is: %s.  Use the Load tab to load an image." % repr(ex.current_file)
            ex.tab_widget.selected_index = ex.load_tab.index
        self.info.value = "<div>%s</div>" % message
        self.button.disabled = True

class LoadTab(FileTab):

    title = "Load"

    def widget(self):
        self.key = None
        self.image = None
        ex = self.in_exporer
        html1 = widgets.HTML("<H1>Load image.</H1>")
        self.info = widgets.HTML("<div>Please select a file using the file tab.</div>")
        self.dropdown = widgets.Dropdown(options=["No images available: please select a file."])
        def dropdown_change(change):
            #self.button.disabled = True
            if change['type'] != 'change' or change.get("name") != 'value':
                return
            h5file = ex.get_file()
            if h5file is None:
                self.info.value = "<div>Please select a file using the file tab.</div>"
                return
            new = self.dropdown.value
            if new != self.option0:
                try:
                    arr = h5file[new]
                except:
                    self.info.value = "<div>Error getting object %s</div>" % new
                else:
                    self.key = new
                    self.image = arr
                    self.info.value = "<div>Object %s has shape %s.</div>" % (new, arr.shape)
                    self.button.disabled = False
            else:
                self.button.disabled = True
        self.dropdown.observe(dropdown_change)
        self.button = widgets.Button(
            description="View image",
            disabled=True,
        )
        def button_click(b):
            ex = self.in_exporer
            try:
                ex.current_image = np.array(self.image, dtype=np.float)
            except:
                self.info.value = "<div>Error loading image</div>"
            else:
                ex.current_key = self.key
                ex.info.value = "<div>Selected array %s</div>" % ex.current_key
                ex.update_all()
        self.button.on_click(button_click)
        self.assembly = widgets.VBox(children=[html1, self.dropdown, self.info, self.button])
        self.update()
        return self.assembly

    def update(self):
        self.button.disabled = True
        ex = self.in_exporer
        self.option0 = "(please select a file)"
        keys = []
        h5file = ex.get_file()
        if h5file is not None:
            for key in h5file:
                ob = h5file[key]
                if len(ob.shape) == 3:
                    keys.append(key)
            h5file.close()
            if len(keys) > 0:
                self.option0 = "(no key selected)"
        options = [self.option0] + keys
        self.dropdown.options = options
        message = "No file chosen."
        if ex.current_key:
            message = "current image is: " + repr(ex.current_key)
        self.info.value = "<div>%s</div>" % message
        self.button.disabled = True