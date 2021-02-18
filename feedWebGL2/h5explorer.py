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

    def __init__(self, folder=".", filters=None):
        self.folder = folder
        self.filters = filters
        self.current_file = None
        self.current_key = None
        self.current_image = None
        self.error = None
        widget = self.make_widget()
        display(widget)

    def make_widget(self):
        self.file_tab = FileTab(self)
        self.tabs = [
            self.file_tab,
        ]
        self.info = widgets.HTML("<div>hdf5 explorer</div>")
        self.volume = volume.Volume32()
        self.volume.element.html("No image yet loaded.")
        tab_children = [t.widget() for t in self.tabs]
        self.tab_widget = widgets.Tab(children=tab_children)
        for (i, t) in enumerate(self.tabs):
            self.tab_widget.set_title(i, t.title)
        self.assembly = widgets.VBox([self.info, self.tab_widget, self.volume])
        return self.assembly

    def update_all(self):
        for t in self.tabs:
            t.update()

    def get_file(self, filename=None, mode="r"):
        filename = filename or self.current_file
        if filename:
            file_path = os.path.join(self.folder, filename)
            self.info.value = "<div>attempting to open %s</div>" % file_path
            try:
                hdf5_file = h5py.File(file_path, mode)
            except Exception as e:
                self.error = e
            else:
                self.info.value = "<div>opened %s</div>" % file_path
                return hdf5_file
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
            message = "current file is: " + repr(ex.current_file)
        self.info.value = "<div>%s</div>" % message
        self.button.disabled = True
