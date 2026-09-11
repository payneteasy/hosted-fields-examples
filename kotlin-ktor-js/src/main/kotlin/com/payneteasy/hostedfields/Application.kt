package com.payneteasy.hostedfields

import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import org.slf4j.LoggerFactory
import java.nio.file.Path
import kotlin.system.exitProcess

private val LOG = LoggerFactory.getLogger("com.payneteasy.hostedfields.Application")

/**
 * Settings are loaded and validated here, before the engine exists.
 *
 * Not lazily out of an object initialiser: the port and the interface decide how the engine is
 * built, and doing it here means the app refuses to boot on a missing credential rather than
 * serving a payment page that cannot take a payment. It is also what lets `./gradlew build` and
 * `./gradlew test` run with no credentials at all, because nothing is validated at class
 * initialisation.
 */
fun main() {
    val settings =
        try {
            Settings.load(Path.of(".env"))
        } catch (e: IllegalStateException) {
            LOG.error("[error] {}", e.message)
            exitProcess(1)
        }

    // The same line every other example prints when it comes up
    LOG.info("listening on http://{}:{}{}/", settings.listenAddr, settings.port, settings.basePath)
    embeddedServer(Netty, port = settings.port.toInt(), host = settings.listenAddr) {
        module(settings)
    }.start(wait = true)
}
