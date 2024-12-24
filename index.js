const { Client, GatewayIntentBits } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ytdl = require('ytdl-core');
require('dotenv').config();
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Bot is running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});
// Music queue
let musicQueue = [];
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});
// Listen for voice state updates (when users join/leave channels)
client.on('voiceStateUpdate', async (oldState, newState) => {
    const user = newState.member.user.username;

    // Check if a user has joined a voice channel
    if (!oldState.channelId && newState.channelId) {
        const channelName = newState.channel.name;
        const guild = newState.guild;

        // Send a message in the default text channel
        const textChannel = guild.channels.cache.find(
            (ch) => ch.type === 0 && ch.permissionsFor(guild.members.me).has('SendMessages')
        );

        if (textChannel) {
            textChannel.send(`🎉 **${user}** has joined the voice channel **${channelName}**!`);
        }

        // Announce in the voice channel
        try {
            const connection = joinVoiceChannel({
                channelId: newState.channel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
            });

            // Use gtts library for text-to-speech generation
            const ttsFilePath = `./welcome-${user}.mp3`;
            exec(
                `python3 -m gtts "Welcome ${user} to the voice channel ${channelName}" --output "${ttsFilePath}"`,
                (err) => {
                    if (err) {
                        console.error('Error generating TTS file:', err);
                        return;
                    }

                    console.log('TTS file generated successfully.');

                    // Play the TTS announcement
                    const resource = createAudioResource(fs.createReadStream(ttsFilePath));
                    const player = createAudioPlayer();
                    connection.subscribe(player);
                    player.play(resource);

                    // Cleanup after playing
                    player.on('idle', () => {
                        fs.unlink(ttsFilePath, (err) => {
                            if (err) console.error('Failed to delete TTS file:', err);
                        });
                        connection.destroy();
                    });

                    player.on('error', (error) => {
                        console.error('Error with player:', error);
                        connection.destroy();
                    });
                }
            );
        } catch (error) {
            console.error('Error joining voice channel or announcing:', error);
        }
    }
});
// Function to play next track in queue
const playNext = (connection, player) => {
    if (musicQueue.length > 0) {
        const filePath = musicQueue.shift(); // Get the next track in the queue
        const resource = createAudioResource(fs.createReadStream(filePath));
        player.play(resource);

        player.on('error', (error) => {
            console.error('Error with player:', error);
        });

        player.on(AudioPlayerStatus.Idle, () => {
            playNext(connection, player); // Play the next song in the queue
        });
    } else {
        connection.destroy(); // Disconnect if no songs are left
    }
};
client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!') || message.author.bot) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Command to play a local audio file from the music folder
    if (command === 'play') {
        const fileName = args[0];
        if (!fileName) {
            return message.reply('Please provide the name of the audio file to play.');
        }

        const filePath = path.join(__dirname, 'Music', fileName);

        if (!fs.existsSync(filePath)) {
            return message.reply('The specified file does not exist in the music folder.');
        }

        if (!message.member.voice.channel) {
            return message.reply('You need to be in a voice channel to play the audio!');
        }

        try {
            const connection = joinVoiceChannel({
                channelId: message.member.voice.channel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            // Add the song to the queue
            musicQueue.push(filePath);
            if (musicQueue.length === 1) {
                // If this is the first song in the queue, start playing
                const player = createAudioPlayer();
                connection.subscribe(player);
                playNext(connection, player);
            }

            message.reply(`Added ${fileName} to the queue.`);
        } catch (error) {
            console.error('Error while playing local audio:', error);
            message.reply('An error occurred while trying to play the audio.');
        }
    }

  // Command to send a message and join a specific voice channel
    if (command === 'join') {
        const channelName = args[0]; // The name of the channel the bot should join
        const textChannel = message.guild.channels.cache.get(message.channel.id);
        
        // Log the available voice channels for debugging
        console.log('Available voice channels:');
        message.guild.channels.cache.filter(ch => ch.type === 'GUILD_VOICE').forEach(channel => {
            console.log(`- ${channel.name}`);
        });

        // Look for the voice channel
        const voiceChannel = message.guild.channels.cache.find(ch => ch.name === channelName && ch.type === 'GUILD_VOICE');
        
        if (!voiceChannel) {
            return message.reply(`No voice channel named "${channelName}" found! Please make sure the name is correct and try again.`);
        }

        // Send a message in the text channel
        message.reply(`I'm going to join the voice channel: ${channelName}!`);

        try {
            // Join the voice channel
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            console.log(`Bot has joined the voice channel: ${channelName}`);

        } catch (error) {
            console.error('Error joining voice channel:', error);
            message.reply('An error occurred while trying to join the voice channel.');
        }
    }

 // Command to download and play YouTube audio
    if (command === 'download') {
        const url = args[0];
        if (!ytdl.validateURL(url)) {
            return message.reply('Please provide a valid YouTube URL.');
        }

        const videoID = ytdl.getVideoID(url);
        const outputPath = path.join(__dirname, 'music', `${videoID}.mp3`);
        const tempFilePath = path.join(__dirname, 'music', `${videoID}_temp.mp4`);

        message.reply('Downloading the YouTube audio, please wait...');

        try {
            // Download the video
            const stream = ytdl(url, { filter: 'audioonly' });

            stream.on('error', (error) => {
                if (error.statusCode === 410) {
                    console.error('Video not available (HTTP 410).');
                    message.reply('The YouTube video is no longer available (HTTP 410). Please check the URL.');
                } else {
                    console.error('Error downloading YouTube audio:', error);
                    message.reply('An error occurred while downloading the YouTube audio.');
                }
            });

            const writeStream = fs.createWriteStream(tempFilePath);
            stream.pipe(writeStream);

            writeStream.on('finish', () => {
                console.log('YouTube video downloaded successfully.');

                // Convert to MP3
                exec(
                    `ffmpeg -i "${tempFilePath}" -codec:a libmp3lame -b:a 192k "${outputPath}"`,
                    (error, stdout, stderr) => {
                        if (error) {
                            console.error('Error converting the audio file:', stderr);
                            return message.reply('An error occurred while converting the audio file.');
                        }

                        console.log('Audio file converted successfully.');

                        // Delete temporary file
                        fs.unlink(tempFilePath, (err) => {
                            if (err) console.error('Error deleting temporary file:', err);
                        });

                        message.reply(`Download complete! File saved as: ${videoID}.mp3`);

                        // Add the downloaded song to the queue and play it
                        if (message.member.voice.channel) {
                            const filePath = outputPath;
                            const connection = joinVoiceChannel({
                                channelId: message.member.voice.channel.id,
                                guildId: message.guild.id,
                                adapterCreator: message.guild.voiceAdapterCreator,
                            });

                            const resource = createAudioResource(fs.createReadStream(filePath));
                            const player = createAudioPlayer();

                            connection.subscribe(player);
                            player.play(resource);

                            player.on('error', (error) => {
                                console.error('Error with player:', error);
                                message.reply('An error occurred while trying to play the audio.');
                            });

                            console.log('Audio is playing in the voice channel!');
                            message.reply(`Now playing: ${videoID}.mp3`);
                        }
                    }
                );
            });

        } catch (error) {
            console.error('Error during the download process:', error);
            message.reply('An error occurred while downloading the YouTube audio.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
