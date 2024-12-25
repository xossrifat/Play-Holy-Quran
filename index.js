const { Client, GatewayIntentBits } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const musicQueue = [];
const activeConnections = new Map();

const playNext = (connection, player) => {
    if (musicQueue.length === 0) {
        const musicFolderPath = path.join(__dirname, 'Music');
        const musicFiles = fs.readdirSync(musicFolderPath).filter(file => file.endsWith('.mp3'));
        musicQueue.push(...musicFiles.map(file => path.join(musicFolderPath, file)));
    }

    if (musicQueue.length > 0) {
        const filePath = musicQueue.shift();
        const resource = createAudioResource(fs.createReadStream(filePath));
        player.play(resource);

        player.on(AudioPlayerStatus.Idle, () => {
            playNext(connection, player);
        });

        player.on('error', (error) => {
            console.error('Error playing audio:', error);
        });
    }
};

const ensureConnection = (guild, voiceChannelId) => {
    if (activeConnections.has(guild.id)) {
        return activeConnections.get(guild.id);
    }

    const connection = joinVoiceChannel({
        channelId: voiceChannelId,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();
    connection.subscribe(player);
    activeConnections.set(guild.id, { connection, player });

    playNext(connection, player);

    return { connection, player };
};

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    const guildId = process.env.GUILD_ID;
    const voiceChannelId = process.env.VOICE_CHANNEL_ID;

    if (!guildId || !voiceChannelId) {
        console.error('GUILD_ID or VOICE_CHANNEL_ID is not set in the environment variables.');
        return;
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        console.error(`Guild with ID ${guildId} not found.`);
        return;
    }

    ensureConnection(guild, voiceChannelId);
});

client.on('voiceStateUpdate', (oldState, newState) => {
    const guildId = process.env.GUILD_ID;
    const voiceChannelId = process.env.VOICE_CHANNEL_ID;

    if (newState.guild.id === guildId && newState.channelId === voiceChannelId) {
        const guild = newState.guild;
        ensureConnection(guild, voiceChannelId);
    }
});

client.login(process.env.DISCORD_TOKEN);
