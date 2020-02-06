
// silly jquery plugin for experimentation only

(function($) {
    $.fn.plugin_functionality = function (options) {
        // plugin implementation here
        console.log("plugin called " + this);
        var settings = $.extend({
            viewBox: "0 0 500 500",
            preserveAspectRatio: "none",
            html: "hello world",
            italic: false,
        }, options);
        this.settings = settings;
        if (settings.italic) {
            this.html("<em>" + settings.html + "</em>");
        } else {
            this.html("<b>" + settings.html + "</b>");
        }
    };
})(jQuery);