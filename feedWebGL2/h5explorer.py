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

    def __init__(self, folder=".", filters=None, width=1400, shape_max=100):
        # use default filters if not provided
        if filters is None:
            filters = [
                LogFilter,
                BlurFilter,
            ]
        self.folder = folder
        # instantiate the filters
        self.filters = [Filter(self) for Filter in filters]
        self.width = width
        self.shape_max = shape_max
        self.current_file = None
        self.current_key = None
        self.current_image = None
        self.error = None
        widget = self.make_widget()
        display(widget)

    def make_widget(self):
        volume.widen_notebook()
        self.file_tab = FileTab(self)
        self.load_tab = LoadTab(self)
        self.filter_tab = FilterTab(self)
        self.save_tab = SaveTab(self)
        self.tabs = [
            self.file_tab,
            self.load_tab,
            self.filter_tab,
            self.save_tab,
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

    def file_path(self, filename):
        return os.path.join(self.folder, filename)

    def get_file(self, filename=None, mode="r"):
        filename = filename or self.current_file
        if filename:
            file_path = self.file_path(filename)
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
        self.in_explorer = in_explorer

    def widget(self):
        html1 = widgets.HTML("<H1>Select file.</H1>")
        self.info = widgets.HTML("<div>No file chosen.</div>")
        self.dropdown = widgets.Dropdown(options=["file list not loaded..."])
        def dropdown_change(change):
            if change['type'] != 'change' or change.get("name") != 'value':
                return
            new = self.dropdown.value
            if new != self.option0:
                ex = self.in_explorer
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
            ex = self.in_explorer
            ex.current_file = self.dropdown.value
            ex.info.value = "<div>Selected file %s</div>" % ex.current_file
            ex.update_all()
        self.button.on_click(button_click)
        self.assembly = widgets.VBox(children=[html1, self.dropdown, self.info, self.button])
        self.update()
        return self.assembly

    def update(self):
        ex = self.in_explorer
        folder = self.in_explorer.folder
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
        ex = self.in_explorer
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
                    self.image = np.array(arr, dtype=np.float)
                    self.info.value = "<div>Object %s has shape %s.  Press the button to load.</div>" % (new, arr.shape)
                    self.button.disabled = False
            else:
                self.button.disabled = True
            h5file.close()
        self.dropdown.observe(dropdown_change)
        self.button = widgets.Button(
            description="View image",
            disabled=True,
        )
        def button_click(b):
            ex = self.in_explorer
            try:
                ex.current_image = self.image # np.array(self.image, dtype=np.float)
            except:
                self.info.value = "<div>Error loading image</div>"
                raise
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
        ex = self.in_explorer
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
            message = "current image is: %s.  Press the button to load the image." % repr(ex.current_key)
        elif ex.current_file:
            message = "Please select an image from current file %s" % ex.current_file
        self.info.value = "<div>%s</div>" % message
        self.button.disabled = True


class FilterTab(FileTab):

    title = "Filter"

    def widget(self):
        ex = self.in_explorer
        html1 = widgets.HTML("<H1>Modify the image using a filter.</H1>")
        filters = ex.filters
        tab_children = [f.widget() for f in filters]
        self.tab_widget = widgets.Tab(children=tab_children)
        for (i, f) in enumerate(filters):
            self.tab_widget.set_title(i, f.title)
            f.index = i
        self.assembly = widgets.VBox([html1, self.tab_widget])
        return self.assembly

    def update(self):
        ex = self.in_explorer
        for f in ex.filters:
            f.update()

class LogFilter(FileTab):

    title = "Logarithm"

    def widget(self):
        html1 = widgets.HTML("<H1>Take logarithm of image values.</H1>")
        self.info = widgets.HTML("<div>Parameters</div>")
        self.shift = widgets.Checkbox(
            value=True,
            description='Shift minimum to 1.0',
        )
        self.base = widgets.BoundedFloatText(
            value=np.e,
            min=2,
            max=10.0,
            step=0.1,
            description='Base:',
            disabled=False
        )
        self.button = widgets.Button(
            description="Take Logarithm",
        )
        self.button.on_click(self.apply)
        return widgets.VBox([html1, self.info, self.shift, self.base, self.button])

    def update(self):
        image_array = self.in_explorer.current_image
        if image_array is None:
            self.info.value = "<div>No array selected: please selecta an array</div>"
        else:
            self.info.value = "<div>Parameters</div>"

    def apply(self, button):
        ex = self.in_explorer
        image_array = ex.current_image
        if image_array is None:
            self.update()
            return
        if self.shift.value:
            # shift array so min value is 1.0
            image_array = image_array + (1.0 - image_array.min())
        log_base = np.log(self.base.value)
        log_image = log_base * np.log(image_array)
        ex.current_image = log_image
        ex.update_all()

class BlurFilter(LogFilter):

    # title is required
    title = "Blur"

    def widget(self):
        "The widget method defines the parameters for the filter."
        html1 = widgets.HTML("<H1>Take logarithm of image values.</H1>")
        # self.info is required
        self.info = widgets.HTML("<div>Parameters</div>")
        # other parameters
        self.sigma = widgets.BoundedFloatText(
            value=2.0,
            min=1.0,
            max=10.0,
            step=0.1,
            description='Sigma:',
            disabled=False
        )
        # apply button is required
        self.button = widgets.Button(
            description="Apply blur",
        )
        self.button.on_click(self.apply)
        # Construct a widget container with all sub-widgets
        return widgets.VBox([html1, self.info, self.sigma, self.button])

    def apply(self, button):
        """
        The apply method defines how to execute the filter using the parameters.
        It must test that the image is defined.
        """
        from scipy.ndimage import gaussian_filter
        ex = self.in_explorer
        image_array = ex.current_image
        if image_array is None:
            # no image: abort...
            self.update()
            return
        # Get parameters
        sigma = self.sigma.value
        # apply the filter to the image
        blurred_image = gaussian_filter(image_array, sigma=sigma)
        # store the modified array
        ex.current_image = blurred_image
        # redisplay all widgets
        ex.update_all()

class SaveTab(FileTab):

    title = "Save"

    def widget(self):
        html1 = widgets.HTML("<H1>Save Image.</H1>")
        self.info = widgets.HTML("<div>Image name must be new and not empty.</div>")
        self.name = widgets.Text(
            value='',
            placeholder='Name to save with',
            description='Name:',
            disabled=False
        )
        self.button_selected = widgets.Button(
            description="Save to selected file",
        )
        self.button_selected.on_click(self.save_to_selected_file)
        self.new_file = widgets.Text(
            value='',
            placeholder='name of new file',
            description='Save to new file name:',
            disabled=False
        )
        self.button_new = widgets.Button(
            description="Save to new file",
        )
        self.button_new.on_click(self.save_to_new_file)
        self.assembly = widgets.VBox(children=[
            html1, 
            self.info, 
            self.name, 
            self.button_selected, 
            self.new_file,
            self.button_new])
        return self.assembly

    def save_to_new_file(self, button):
        ex = self.in_explorer
        filename = self.new_file.value
        path = ex.file_path(filename)
        if os.path.exists(path):
            self.info.value = "<div>File name exists.  Please provide an unused new name.</div>"
            returnrai

        if not filename.endswith(".h5"):
            self.info.value = "<div>Please provide new file name endint in '.h5'.</div>"
            return
        self.save(filename, mode="r+")

    def save_to_selected_file(self, button):
        self.save(None)

    def save(self, filename=None, mode="x"):
        ex = self.in_explorer
        success = False
        if ex.current_image is None:
            self.info.value = "<div>There is no current image to save</div>"
            return
        try:
            h5file = ex.get_file(filename, mode="a")
        except:
            self.info.value = "Failed to open file."
            return
        name = self.name.value
        if (name in h5file) or not name:
            self.info.value = "Save name must be new and must not be empty."
        else:
            h5file[name] = ex.current_image
            ex.info.value = "saved image as %s." % repr(name)
            success = True
        h5file.close()
        if success:
            ex.update_all()

    def update(self):
        self.info.value = "<div>Image name must be new and not empty.</div>"
