plugins {
    kotlin("jvm") version "2.4.20"
    kotlin("plugin.serialization") version "2.4.20"
    // Brings the application plugin and `buildFatJar` with it
    id("io.ktor.plugin") version "3.5.2"
    id("org.jlleitschuh.gradle.ktlint") version "14.2.0"
}

group = "com.payneteasy"
version = "0.1.0"

application {
    mainClass = "com.payneteasy.hostedfields.ApplicationKt"
}

ktor {
    fatJar {
        // A fixed name, so release.yml and e2e-tests/src/apps.ts can both name the jar
        archiveFileName = "hosted-fields-example-kotlin.jar"
    }
}

repositories {
    mavenCentral()
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        // Kotlin has no `go vet`. This is the closest thing in the box, and ktlintCheck below is
        // the counterpart of gofmt itself.
        allWarningsAsErrors = true
    }
}

dependencies {
    // Ktor is the subject of the example, and everything the integration itself needs is in the
    // JDK: java.net.http calls the gateway, java.security signs, and MessageDigest, SecureRandom
    // and HexFormat do the rest. kotlinx.serialization is here because the JVM has no JSON of its
    // own — it reads the gateway's replies and writes the one generated file, config.js.
    implementation("io.ktor:ktor-server-core-jvm:3.5.2")
    implementation("io.ktor:ktor-server-netty-jvm:3.5.2")
    // HEAD answered wherever GET is, which Go's mux and Tomcat both do by themselves
    implementation("io.ktor:ktor-server-auto-head-response-jvm:3.5.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    // Ktor logs through SLF4J and refuses to start without a backend
    runtimeOnly("ch.qos.logback:logback-classic:1.5.38")

    testImplementation(kotlin("test"))
}

// views/ and public/ are copies of shared/, kept in step by scripts/sync-shared.sh. They are
// packaged into the jar rather than read from the working directory: this is the Kotlin
// counterpart of go-js's //go:embed, and it is what makes the artefact one file with nothing
// beside it. Change a page and you have to rebuild — there is nothing to edit on a server.
tasks.processResources {
    from("public") { into("public") }
    from("views") { into("views") }
}

tasks.test {
    useJUnitPlatform()
}
