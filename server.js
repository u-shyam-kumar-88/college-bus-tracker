require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Connect to Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// REST API: Load all buses & last saved location on startup
app.get("/api/buses", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("buses")
      .select("*")
      .order("bus_id", { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Real-Time Socket Engine
io.on("connection", (socket) => {
  console.log("Device connected:", socket.id);

  // Student selects a bus -> Join room
  socket.on("join-bus-room", (busId) => {
    socket.rooms.forEach((room) => {
      if (room !== socket.id) socket.leave(room);
    });
    socket.join(busId);
  });

  // Receive GPS telemetry from driver phone or desk simulator
  socket.on("bus-location-update", async (payload) => {
    const { busId, lat, lng, speedKmh, heading } = payload;

    // 1. Broadcast instantly to students watching this bus (Sub-second socket stream)
    io.to(busId).emit("bus-stream", {
      busId,
      lat,
      lng,
      speedKmh: speedKmh || 0,
      heading: heading || 0,
      timestamp: Date.now(),
    });

    // 2. Persist latest coordinates to Supabase PostgreSQL
    const { error } = await supabase.from("buses").upsert(
      {
        bus_id: busId,
        lat,
        lng,
        speed_kmh: speedKmh || 0,
        heading: heading || 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "bus_id" },
    );

    if (error) console.error("Supabase update error:", error.message);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
