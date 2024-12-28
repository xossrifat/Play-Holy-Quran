
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { VoiceConnectionStatus, entersState, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, joinVoiceChannel } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
require('./keep-alive');

// Initialize the client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

let musicQueue = [];
let currentPlayer = null;
let currentConnection = null;
let currentSongIndex = 0; // Track the current song index
let isPaused = false;
let isLooping = false;
let isShuffling = false;
let controlMessage = null;

// Helper function to load music files from the music folder
const loadMusicQueue = () => {
    const musicFolderPath = path.join(__dirname, 'Music');
    const musicFiles = fs.readdirSync(musicFolderPath).filter(file => file.endsWith('.mp3'));
    return musicFiles.map(file => path.join(musicFolderPath, file));
};

// Function to play the next song in the queue
const playNext = () => {
    if (!currentConnection || musicQueue.length === 0) return;

    const filePath = musicQueue[currentSongIndex];
    const resource = createAudioResource(fs.createReadStream(filePath));

    currentPlayer.play(resource);

    currentPlayer.on(AudioPlayerStatus.Idle, () => {
        if (isLooping) {
            playNext();
        } else if (musicQueue.length > 0) {
            currentSongIndex = (currentSongIndex + 1) % musicQueue.length;
            playNext();
        } else {
            console.log('Queue is empty, stopping playback.');
            currentConnection.destroy(); // Disconnect from the channel when queue is empty
        }
        updateControlMessage();
    });

    currentPlayer.on('error', (error) => {
        console.error('Error playing audio:', error);
    });

    updateControlMessage();
};

// Function to update the control message
// Function to update the control message
const updateControlMessage = async () => {
    const textChannelId = process.env.TEXT_CHANNEL_ID;
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) return;

    const textChannel = guild.channels.cache.get(textChannelId);
    if (!textChannel) return;

    const nowPlaying = musicQueue[currentSongIndex] ? `Now playing: ${path.basename(musicQueue[currentSongIndex])}` : 'No music is currently playing.';

    try {
        if (controlMessage) {
            await controlMessage.edit({
                content: nowPlaying,
                components: [createMusicButtons()],
            });
        } else {
            controlMessage = await textChannel.send({
                content: nowPlaying,
                components: [createMusicButtons()],
            });
        }
    } catch (error) {
        console.error('Failed to update control message:', error);
        controlMessage = null; // Reset if the message no longer exists
    }
};



// Function to handle control command
const handleControlCommand = async (textChannel) => {
    if (controlMessage) {
        try {
            await controlMessage.delete();
        } catch (error) {
            console.error('Failed to delete old control message:', error);
        }
        controlMessage = null;
    }

    const nowPlaying = musicQueue[currentSongIndex] ? `Now playing: ${path.basename(musicQueue[currentSongIndex])}` : 'No music is currently playing.';

    try {
        controlMessage = await textChannel.send({
            content: nowPlaying,
            components: [createMusicButtons()],
        });
    } catch (error) {
        console.error('Failed to send new control message:', error);
    }
};
// Shuffle the music queue
const shuffleQueue = () => {
    for (let i = musicQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [musicQueue[i], musicQueue[j]] = [musicQueue[j], musicQueue[i]];
    }
    currentSongIndex = 0; // Reset the index to 0 after shuffling
    playNext();
};

// Create the message action row with buttons
const createMusicButtons = () => {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('previous')
                .setLabel('Previous')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('next')
                .setLabel('Next')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('pause')
                .setLabel('Pause/Resume')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('shuffle')
                .setLabel('Shuffle')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('loop')
                .setLabel('Loop')
                .setStyle(ButtonStyle.Secondary)
        );
};

// setup
const setupVoiceConnection = (channelId, guildId, adapterCreator) => {
    try {
        const connection = joinVoiceChannel({
            channelId,
            guildId,
            adapterCreator,
        });

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            console.warn('Disconnected from the voice channel.');
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5000),
                ]);
                console.log('Successfully reconnected.');
            } catch {
                console.error('Reconnection failed. Destroying connection.');
                connection.destroy();
            }
        });

        connection.on(VoiceConnectionStatus.Destroyed, () => {
            console.log('Connection destroyed.');
        });

        connection.on('error', (error) => {
            console.error('Voice connection error:', error);
        });

        return connection;
    } catch (error) {
        console.error('Error setting up voice connection:', error);
        return null;
    }
};






// Command handler for bot commands
client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!') || message.author.bot) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Get the text channel ID from the environment variable
    const textChannelId = process.env.TEXT_CHANNEL_ID;
    const guild = client.guilds.cache.get(process.env.GUILD_ID);

    if (!guild) {
        return message.reply('Guild not found.');
    }

    const textChannel = guild.channels.cache.get(textChannelId);

    if (!textChannel) {
        return message.reply('Text channel not found.');
    }

    // Play specific song or resume if no song is specified
    if (command === 'play') {
        const musicFolderPath = path.join(__dirname, 'Music');
        const musicFiles = fs.readdirSync(musicFolderPath).filter(file => file.endsWith('.mp3'));

        const input = args[0];
        const songIndex = parseInt(input, 10) - 1;

        if (!isNaN(songIndex) && songIndex >= 0 && songIndex < musicFiles.length) {
            currentSongIndex = songIndex;
            musicQueue = musicFiles.map(file => path.join(musicFolderPath, file));
            if (currentPlayer && currentConnection) {
                playNext();
            } else {
                const channelId = process.env.VOICE_CHANNEL_ID;
                const guildId = process.env.GUILD_ID;
                const guild = client.guilds.cache.get(guildId);

                if (!guild) return message.reply('Guild not found.');

                currentConnection = setupVoiceConnection(channelId, guildId, guild.voiceAdapterCreator);

                currentPlayer = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
                currentConnection.subscribe(currentPlayer);

                playNext();
            }
            await handleControlCommand(textChannel);
          //  textChannel.send(`Now playing: ${musicFiles[songIndex]}`);
        } else if (!input) {
            if (!currentPlayer || !currentConnection) return textChannel.send('No music is currently playing.');
            if (isPaused) {
                currentPlayer.unpause();
                isPaused = false;
                textChannel.send('Playback resumed.');
            } else {
                textChannel.send('Playback is already running.');
            }
        } else {
            textChannel.send(`Invalid song number or input. Use \`$list\` to see available songs.`);
        }
    }

    // Pause playback
    if (command === 'pause') {
        if (!currentPlayer || isPaused) {
            return textChannel.send('No music is currently playing or it is already paused.');
        }
        currentPlayer.pause();
        isPaused = true;
        textChannel.send('Playback paused.');
    }

    // Resume playback
    if (command === 'resume') {
        if (!currentPlayer || !isPaused) {
            return textChannel.send('No music is currently paused.');
        }
        currentPlayer.unpause();
        isPaused = false;
        textChannel.send('Playback resumed.');
    }

    // Skip to next song
    if (command === 'next') {
        if (musicQueue.length === 0) {
            return textChannel.send('The queue is empty. Add more songs to play next.');
        }
        currentSongIndex = (currentSongIndex + 1) % musicQueue.length;
        playNext();
        textChannel.send(`Now playing: ${path.basename(musicQueue[currentSongIndex])}`);
    }

    // List songs in the Music folder
    if (command === 'list') {
        const musicFolderPath = path.join(__dirname, 'Music');
        const musicFiles = fs.readdirSync(musicFolderPath).filter(file => file.endsWith('.mp3'));

        let songList = '';
        musicFiles.forEach((file, index) => {
            songList += `${index + 1}. ${file}\n`;
        });

        // Split the message if it's too long
        const chunks = splitMessage(songList);

        // Send each chunk as a separate message
        for (let chunk of chunks) {
            await textChannel.send(chunk);
        }
    }

   // Help command
    if (command === 'help') {
        textChannel.send(`Available commands:\n` +
            `\`$play [number]\` - Play a specific song by its number or resume playback.\n` +
            `\`$pause\` - Pause the current playback.\n` +
            `\`$resume\` - Resume playback.\n` +
            `\`$next\` - Skip to the next song.\n` +
            `\`$list\` - List all songs in the Music folder.\n` +
            `\`$control\` - Reset and create a new control message.\n`);
    }

    // Shuffle command
    if (command === 'shuffle') {
        if (musicQueue.length === 0) {
            return textChannel.send('The queue is empty. Add more songs to shuffle.');
        }
        shuffleQueue();
        textChannel.send('The queue has been shuffled.');
    }

 // Control command
    if (command === 'control') {
        await handleControlCommand(textChannel);
    }
    
    // Loop command
    if (command === 'loop') {
        isLooping = !isLooping;
        textChannel.send(`Looping is now ${isLooping ? 'enabled' : 'disabled'}.`);
    }
});

// Split message into chunks
const splitMessage = (message, maxLength = 2000) => {
    const chunks = [];
    for (let i = 0; i < message.length; i += maxLength) {
        chunks.push(message.slice(i, i + maxLength));
    }
    return chunks;
};

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    try {
        if (interaction.customId === 'next') {
            currentSongIndex = (currentSongIndex + 1) % musicQueue.length;
            playNext();
            await interaction.update({
                content: `Now playing: ${path.basename(musicQueue[currentSongIndex])}`,
                components: [createMusicButtons()],
            });
        } else if (interaction.customId === 'previous') {
            currentSongIndex = (currentSongIndex - 1 + musicQueue.length) % musicQueue.length;
            playNext();
            await interaction.update({
                content: `Now playing: ${path.basename(musicQueue[currentSongIndex])}`,
                components: [createMusicButtons()],
            });
        } else if (interaction.customId === 'pause') {
            if (isPaused) {
                currentPlayer.unpause();
                isPaused = false;
                await interaction.update({
                    content: `Resumed playing: ${path.basename(musicQueue[currentSongIndex])}`,
                    components: [createMusicButtons()],
                });
            } else {
                currentPlayer.pause();
                isPaused = true;
                await interaction.update({
                    content: 'Playback paused.',
                    components: [createMusicButtons()],
                });
            }
        } else if (interaction.customId === 'shuffle') {
            isShuffling = !isShuffling;
            if (isShuffling) {
                shuffleQueue();
                await interaction.update({
                    content: 'Queue shuffled!',
                    components: [createMusicButtons()],
                });
            } else {
                await interaction.update({
                    content: 'Shuffle disabled.',
                    components: [createMusicButtons()],
                });
            }
        } else if (interaction.customId === 'loop') {
            isLooping = !isLooping;
            await interaction.update({
                content: isLooping ? 'Looping enabled.' : 'Looping disabled.',
                components: [createMusicButtons()],
            });
        } 
    } catch (error) {
        console.error('Error responding to interaction:', error);
    }
});

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    const guildId = process.env.GUILD_ID;
    const channelId = process.env.VOICE_CHANNEL_ID;
    const textChannelId = process.env.TEXT_CHANNEL_ID;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        console.error('Guild not found.');
        return;
    }

    // Join the voice channel and start playing music
    currentConnection = setupVoiceConnection(channelId, guildId, guild.voiceAdapterCreator);

    currentPlayer = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    currentConnection.subscribe(currentPlayer);

    // Load initial queue and start playback
    musicQueue = loadMusicQueue();
    playNext();
});

client.login(process.env.DISCORD_TOKEN);
