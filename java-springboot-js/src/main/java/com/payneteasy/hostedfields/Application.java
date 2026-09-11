package com.payneteasy.hostedfields;

import java.nio.file.Path;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;

/** The entry point: settings first, then the server. */
@SpringBootApplication
public class Application {

    private static final Logger LOG = LoggerFactory.getLogger(Application.class);

    private final Settings settings;

    Application(Settings settings) {
        this.settings = settings;
    }

    /**
     * Settings are loaded and validated here, before anything else exists.
     *
     * <p>Not in a {@code @ConfigurationProperties} bean: three of them — the port, the interface
     * and BASE_PATH — decide how the servlet container is built, so they have to be known before it
     * starts. Doing it here also means the app refuses to boot on a missing credential rather than
     * serving a payment page that cannot take a payment, and that {@code ./mvnw verify} needs no
     * credentials, because nothing is validated at class initialisation.
     */
    public static void main(String[] args) {
        try {
            Settings settings = Settings.load(Path.of(".env"));
            new SpringApplicationBuilder(Application.class)
                    .properties(Map.of(
                            "server.port", settings.port(),
                            "server.address", settings.listenAddr(),
                            // Every route lives under BASE_PATH. As the context path it also buys
                            // Tomcat's redirect from the bare prefix to the trailing-slash form,
                            // which is what keeps the relative asset URLs on the pages working.
                            "server.servlet.context-path", settings.basePath()))
                    // The one instance, handed to the controller as a bean
                    .initializers(context -> context.getBeanFactory().registerSingleton("settings", settings))
                    .run(args);
        } catch (IllegalStateException e) {
            LOG.error("[error] {}", e.getMessage());
            System.exit(1);
        }
    }

    /** The same line every other example prints when it comes up. */
    @EventListener(ApplicationReadyEvent.class)
    void listening() {
        LOG.info("listening on http://{}:{}{}/", settings.listenAddr(), settings.port(), settings.basePath());
    }
}
