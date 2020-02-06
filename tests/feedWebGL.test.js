

// var index = require('../dist/index');
import feedWebGL_is_loaded from "../dist/index";

describe('testing feedWebGL', () => {

    it('loads the index', () => {
        //expect(true).toEqual(true);
        expect(feedWebGL_is_loaded()).toBe(true);
    });

    it("defines the plugin", () => {
        expect(global.jQuery.fn.plugin_functionality).toBeTruthy();
    });

    it("attaches settings", () => {
        var elt = jQuery("<b>test</b>");
        elt.plugin_functionality();
        expect(elt.settings.viewBox).toBe("0 0 500 500");
    });

    it("changes html", () => {
        var elt = jQuery("<b>test</b>");
        elt.plugin_functionality();
        expect(elt.html()).toBe("<b>hello world</b>");
    });

    it("uses html from settings", () => {
        var elt = jQuery("<b>test</b>");
        elt.plugin_functionality({html: "whoop"});
        expect(elt.html()).toBe("<b>whoop</b>");
    });

    it("does italic", () => {
        var elt = jQuery("<b>test</b>");
        elt.plugin_functionality({html: "whoop", italic: true});
        expect(elt.html()).toBe("<em>whoop</em>");
    });

  });
