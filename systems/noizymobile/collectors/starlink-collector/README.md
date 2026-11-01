Starlink collector (starter)

This is a minimal scaffold for a Starlink telemetry collector.

Purpose

- Poll the local Starlink terminal (default 192.168.100.1:9200)
- Normalize telemetry into a stable envelope
- Publish telemetry to MQTT (topic prefix: noizymobile/starlink)
- Persist to InfluxDB or SQLite (not yet implemented)

Run (development)

1. Build the image:
   docker build -t starlink-collector:local ./starlink-collector
2. Run with environment variables to point at your terminal and MQTT broker
   docker run --rm -e MQTT_BROKER=mosquitto -e MQTT_PORT=1883 starlink-collector:local

TODO

- Integrate sparky8512/starlink-grpc-tools or native gRPC client
- Add InfluxDB persistence and batching
- Add signed telemetry envelope and schema validation
- Add unit and integration tests
